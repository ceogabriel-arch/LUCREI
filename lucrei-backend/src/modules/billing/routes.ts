import crypto from 'node:crypto';

import type { FastifyInstance } from 'fastify';

import { applyPercentOff } from '../../lib/coupons';
import { sendOpsAlertEmail } from '../../lib/email';
import { verifyHypercashSignature } from '../../lib/hypercash-webhook';
import { prisma } from '../../lib/prisma';
import { ensureCurrentPixCharge } from '../../lib/pix-billing';
import { formatBRL, sendPushNotification } from '../../lib/push-notifications';
import { mapHypercashStatus, mapMercadoPagoStatus } from '../../lib/subscription-sync';
import { getPayment, getPreapproval, updatePreapprovalValue } from '../../mercadopago-client';
import {
  cancelSubscription as cancelHypercashSubscription,
  createPaymentLink,
  deactivatePaymentLink,
  getSubscriptionByPaymentLinkId,
  priceToCents,
} from '../../hypercash-client';

const BACK_URL = process.env.PUBLIC_APP_URL || 'https://lucrei-production-bce6.up.railway.app';

type WebhookBody = {
  type?: string;
  data?: { id?: string };
};

function verifySignature(xSignature: string | undefined, xRequestId: string | undefined, dataId: string, secret: string) {
  if (!xSignature || !xRequestId) return false;

  const parts: Record<string, string> = {};
  for (const part of xSignature.split(',')) {
    const [key, value] = part.trim().split('=');
    if (key && value) parts[key] = value;
  }
  if (!parts.ts || !parts.v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${parts.ts};`;
  const computed = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return computed.length === parts.v1.length && crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(parts.v1));
}

async function handlePreapprovalEvent(dataId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: { provider: 'mercado_pago', providerSubscriptionId: dataId },
  });
  // Já cancelamos essa assinatura por aqui (troca de método de pagamento,
  // cancelamento pelo usuário) - um webhook atrasado ou reenviado pela
  // Mercado Pago não deve reativar ela sozinho.
  if (!subscription || subscription.status === 'canceled') return;

  const preapproval = await getPreapproval(dataId);
  const status = mapMercadoPagoStatus(preapproval.status);
  // A cada renovação a Mercado Pago não manda um webhook novo de status (o
  // preapproval continua 'authorized') - por isso guardamos aqui a próxima
  // data de cobrança sempre que consultamos, não só quando o status muda.
  // É isso que createProratedUpgradeCharge/findActivePaidCycle usam pra
  // saber até quando uma assinatura de cartão está paga.
  const nextPeriodEnd = preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : undefined;
  if (!status && !nextPeriodEnd) return;

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscription.id },
      data: { ...(status ? { status } : {}), ...(nextPeriodEnd ? { currentPeriodEnd: nextPeriodEnd } : {}) },
    }),
    ...(status ? [prisma.user.update({ where: { id: subscription.userId }, data: { subscriptionStatus: status } })] : []),
  ]);
}

async function handleUpgradeChargePaid(app: FastifyInstance, charge: { id: string; subscriptionId: string; amount: unknown; targetPlanId: string }) {
  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: charge.subscriptionId } });
  const targetPlan = await prisma.plan.findUnique({ where: { id: charge.targetPlanId } });
  if (!targetPlan) {
    // O dinheiro já foi capturado (a cobrança chegou até aqui como aprovada)
    // mas não tem mais plano pra aplicar - fica só o log mesmo, precisa de
    // reconciliação manual. Não tenta de novo sozinho: a Mercado Pago não
    // reenvia o webhook de pagamento indefinidamente pra ficar re-tentando.
    app.log.error(
      { chargeId: charge.id, targetPlanId: charge.targetPlanId },
      'Cobrança de upgrade aprovada mas o plano de destino não existe mais - upgrade não aplicado.'
    );
    return;
  }

  // Assinatura por cartão continua cobrando na renovação anual - sem
  // atualizar o valor lá antes de aplicar o plano novo aqui, o cliente ficaria
  // com os recursos do plano caro mas continuaria sendo cobrado o valor do
  // plano antigo pra sempre. Só aplica o plano localmente depois de confirmar
  // que a Mercado Pago aceitou o novo valor.
  if (subscription.provider === 'mercado_pago' && subscription.providerSubscriptionId && targetPlan.priceCurrent !== null) {
    try {
      await updatePreapprovalValue(subscription.providerSubscriptionId, Number(targetPlan.priceCurrent));
    } catch (err) {
      app.log.error(
        { err, subscriptionId: subscription.id, targetPlanId: targetPlan.id },
        'Falha ao atualizar o valor da assinatura no cartão após upgrade pago - plano NÃO aplicado, precisa de retry manual.'
      );
      return;
    }
  }

  const user = await prisma.user.update({ where: { id: subscription.userId }, data: { planId: targetPlan.id } });

  if (user.pushToken) {
    await sendPushNotification(
      user.pushToken,
      'Upgrade confirmado! 🎉',
      `Você agora está no plano ${targetPlan.name}.`
    ).catch((err) => app.log.error(err));
  }
}

// Revoga o acesso de uma cobrança estornada/contestada - sem isso, um pagamento
// devolvido pelo Mercado Pago (chargeback, reembolso) nunca é detectado: o
// handler só olhava pra status "approved" novo, então uma cobrança já
// aprovada que depois vira "refunded"/"charged_back" ficava intocada pra
// sempre, com a assinatura continuando "active".
async function handleChargeReversed(app: FastifyInstance, charge: { id: string; subscriptionId: string }, mpStatus: string) {
  await prisma.pixCharge.update({ where: { id: charge.id }, data: { status: 'canceled' } });
  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: charge.subscriptionId } });
  await prisma.$transaction([
    prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'canceled' } }),
    prisma.user.update({ where: { id: subscription.userId }, data: { subscriptionStatus: 'canceled' } }),
  ]);
  app.log.warn({ chargeId: charge.id, mpStatus }, 'Pagamento Pix estornado/contestado pela Mercado Pago - assinatura cancelada.');
}

async function handlePaymentEvent(app: FastifyInstance, dataId: string) {
  const charge = await prisma.pixCharge.findUnique({ where: { mercadoPagoPaymentId: dataId } });
  if (!charge) return;

  const payment = await getPayment(dataId);

  if (payment.status === 'refunded' || payment.status === 'charged_back') {
    if (charge.status !== 'canceled') {
      await handleChargeReversed(app, charge, payment.status);
    }
    return;
  }

  if (charge.status === 'approved') return;
  if (payment.status !== 'approved') return;

  // Guarda atômica contra o Mercado Pago reenviar o mesmo webhook (eles
  // avisam que isso acontece) - sem isso, dois eventos quase simultâneos
  // passariam os dois pela checagem "status === 'approved'" lá em cima
  // antes de qualquer um gravar, e processariam o mesmo pagamento 2x
  // (notificação duplicada, chamada duplicada pra Mercado Pago no upgrade).
  const claimed = await prisma.pixCharge.updateMany({
    where: { id: charge.id, status: { not: 'approved' } },
    data: { status: 'approved', paidAt: new Date() },
  });
  if (claimed.count === 0) return;

  if (charge.targetPlanId) {
    await handleUpgradeChargePaid(app, { ...charge, targetPlanId: charge.targetPlanId });
    return;
  }

  const existingSubscription = await prisma.subscription.findUniqueOrThrow({ where: { id: charge.subscriptionId } });

  // Numa transação: se travar entre as duas escritas, a assinatura não
  // pode ficar "active" com o usuário ainda preso em "past_due" (ou
  // vice-versa), travando acesso de quem já pagou.
  const [, user] = await prisma.$transaction([
    prisma.subscription.update({
      where: { id: charge.subscriptionId },
      data: { status: 'active', currentPeriodEnd: charge.periodEnd },
    }),
    prisma.user.update({
      where: { id: existingSubscription.userId },
      data: { subscriptionStatus: 'active' },
    }),
  ]);

  if (user.pushToken) {
    await sendPushNotification(
      user.pushToken,
      'Pagamento confirmado! 🎉',
      `Recebemos seu Pix de ${formatBRL(Number(charge.amount))}. Sua assinatura Lucrei está ativa.`
    ).catch((err) => app.log.error(err));
  }
}

type HypercashSubscriptionEventData = {
  subscription?: {
    paymentLinkId?: string | null;
    status?: 'active' | 'paused' | 'cancelled' | 'expired' | 'payment_failed';
    currentPeriodEnd?: string | null;
  };
};

/**
 * Em vez de decidir o que fazer a partir do NOME do evento ("type") - que a
 * HyperCash não documenta em lugar nenhum público, só confirmamos o evento
 * de teste ("subscription.test") - usa o campo "status" da assinatura
 * (esse sim documentado no OpenAPI deles) como fonte da verdade e sincroniza
 * pra ele, qualquer que seja o evento que disparou o webhook. Mesmo
 * princípio de reconcileHypercashSubscription (subscription-sync.ts), só que
 * reagindo ao payload do webhook em vez de consultar a API de novo.
 * Devolve false quando o payload não tem o formato esperado (deixa quem
 * chamou decidir se alerta).
 */
async function handleHypercashSubscriptionEvent(app: FastifyInstance, data: HypercashSubscriptionEventData) {
  const subData = data.subscription;
  if (!subData?.paymentLinkId || !subData?.status) return false;

  const subscription = await prisma.subscription.findFirst({
    where: { provider: 'hypercash', providerSubscriptionId: subData.paymentLinkId },
  });
  // Já cancelamos essa assinatura por aqui - um webhook atrasado ou
  // reenviado não deve reativar ela sozinho (mesmo princípio do handler da
  // Mercado Pago).
  if (!subscription || subscription.status === 'canceled') return true;

  const status = mapHypercashStatus(subData.status);
  const nextPeriodEnd = subData.currentPeriodEnd ? new Date(subData.currentPeriodEnd) : undefined;

  const statusChanged = status !== subscription.status;
  const periodChanged =
    nextPeriodEnd !== undefined && nextPeriodEnd.getTime() !== (subscription.currentPeriodEnd?.getTime() ?? -1);
  // Reentrega do mesmo evento (a HyperCash pode reenviar, como a Mercado
  // Pago já faz) vira um no-op aqui - idempotente sem precisar de guarda
  // explícita, já que só grava quando algo de fato mudou.
  if (!statusChanged && !periodChanged) return true;

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscription.id },
      data: { ...(statusChanged ? { status } : {}), ...(periodChanged ? { currentPeriodEnd: nextPeriodEnd } : {}) },
    }),
    ...(statusChanged ? [prisma.user.update({ where: { id: subscription.userId }, data: { subscriptionStatus: status } })] : []),
  ]);

  if (statusChanged && status === 'active') {
    const user = await prisma.user.findUnique({ where: { id: subscription.userId } });
    if (user?.pushToken) {
      await sendPushNotification(
        user.pushToken,
        'Pagamento confirmado! 🎉',
        'Sua assinatura Lucrei está ativa.'
      ).catch((err) => app.log.error(err));
    }
  }

  return true;
}

// Mesmo valor pago "pra sempre" que já vale pra cada cobrança recorrente
// nova (ver coupons.ts) - a assinatura nova criada aqui pro upgrade segue a
// mesma regra.
const PAID_UPGRADE_STATUSES = new Set(['paid', 'approved', 'completed', 'success']);

/**
 * Cobrança proporcional do upgrade confirmada - aplica o plano novo na hora
 * (acesso liberado já) e troca a assinatura recorrente pelo valor cheio do
 * plano novo (decisão já tomada: a HyperCash não deixa atualizar o valor de
 * uma assinatura ativa, só cancelar+criar outra). A assinatura antiga, já
 * paga até o fim do ciclo atual, é cancelada - a pessoa já está no plano novo
 * agora, não faz sentido continuar cobrando pelo antigo depois. A conta
 * entra em 'past_due' com o link da assinatura nova pronto pra pagar (mesmo
 * fluxo/UI que já existe pra qualquer assinatura pendente) - não tem como
 * evitar um 2º checkout aqui, HyperCash não aceita trocar valor de assinatura
 * ativa nem reaproveitar cartão salvo.
 */
async function applyHypercashUpgrade(app: FastifyInstance, charge: { id: string; subscriptionId: string; targetPlanId: string }) {
  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: charge.subscriptionId } });
  const targetPlan = await prisma.plan.findUnique({ where: { id: charge.targetPlanId } });
  if (!targetPlan || targetPlan.priceCurrent === null) {
    // Dinheiro já capturado mas não tem mais plano pra aplicar - precisa de
    // reconciliação manual, não tenta de novo sozinho.
    app.log.error(
      { chargeId: charge.id, targetPlanId: charge.targetPlanId },
      'Cobrança de upgrade (HyperCash) aprovada mas o plano de destino não existe mais - upgrade não aplicado.'
    );
    sendOpsAlertEmail(
      app,
      'Upgrade HyperCash pago sem plano de destino válido',
      `chargeId: ${charge.id}\ntargetPlanId: ${charge.targetPlanId}`
    ).catch(() => {});
    return;
  }

  if (subscription.providerSubscriptionId) {
    try {
      const hcSubscription = await getSubscriptionByPaymentLinkId(subscription.providerSubscriptionId);
      if (hcSubscription) await cancelHypercashSubscription(hcSubscription.id);
      await deactivatePaymentLink(subscription.providerSubscriptionId);
    } catch (err) {
      // Não bloqueia o upgrade por falha ao cancelar a antiga - pior caso é
      // cobrar 2 assinaturas até alguém notar, bem menos grave que travar o
      // upgrade já pago.
      app.log.error({ err, subscriptionId: subscription.id }, 'Falha ao cancelar a assinatura HyperCash antiga após upgrade pago.');
    }
  }

  const effectivePercentOff = subscription.pendingCouponPercentOff;
  const amount = effectivePercentOff != null ? applyPercentOff(Number(targetPlan.priceCurrent), effectivePercentOff) : Number(targetPlan.priceCurrent);

  let link;
  try {
    link = await createPaymentLink({
      name: `Lucrei - Plano ${targetPlan.name}`,
      priceCents: priceToCents(amount),
      isRecurring: true,
      frequency: targetPlan.billingPeriod === 'annual' ? 'annual' : 'monthly',
      successRedirectUrl: `${BACK_URL}/planos`,
    });
  } catch (err) {
    // Upgrade já foi PAGO - não reverte o plano por causa disso, só fica sem
    // o link da assinatura nova pra pagar (a próxima tentativa de
    // /plans/select gera um na hora, igual já faz pra qualquer past_due sem
    // link). Alerta pra alguém acompanhar de perto esse caso.
    app.log.error({ err, chargeId: charge.id }, 'Falha ao criar a assinatura recorrente nova após upgrade pago.');
    sendOpsAlertEmail(
      app,
      'Upgrade HyperCash pago mas falha ao criar a assinatura recorrente nova',
      `chargeId: ${charge.id}\nsubscriptionId: ${subscription.id}\nerro: ${err instanceof Error ? err.message : String(err)}`
    ).catch(() => {});
    link = null;
  }

  await prisma.$transaction([
    prisma.hypercashUpgradeCharge.update({ where: { id: charge.id }, data: { status: 'paid', paidAt: new Date() } }),
    prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'past_due',
        providerSubscriptionId: link?.id ?? null,
        lastInvoiceUrl: link?.checkoutUrl ?? null,
      },
    }),
    prisma.user.update({ where: { id: subscription.userId }, data: { planId: targetPlan.id, subscriptionStatus: 'past_due' } }),
  ]);

  const user = await prisma.user.findUnique({ where: { id: subscription.userId } });
  if (user?.pushToken) {
    await sendPushNotification(
      user.pushToken,
      'Upgrade confirmado! 🎉',
      link
        ? `Você já está no plano ${targetPlan.name}. Só falta finalizar a nova assinatura recorrente pra manter o acesso.`
        : `Você já está no plano ${targetPlan.name}.`
    ).catch((err) => app.log.error(err));
  }
}

type HypercashTransactionEventData = {
  transaction?: {
    paymentLinkId?: string | null;
    status?: string;
  };
};

/**
 * Mesmo princípio de handleHypercashSubscriptionEvent: formato do payload
 * ainda NÃO confirmado contra um evento real (a HyperCash não tem um botão
 * de teste pra essa categoria, diferente da Recorrência) - chute por
 * simetria com o formato já confirmado de assinatura
 * (data.subscription.paymentLinkId/.status vira
 * data.transaction.paymentLinkId/.status aqui). Devolve false quando o
 * payload não bate com esse formato OU quando o paymentLinkId não é de
 * nenhum upgrade nosso (payment-link de assinatura normal, não de upgrade) -
 * os dois casos deixam quem chamou decidir se alerta.
 */
async function handleHypercashUpgradeChargeEvent(app: FastifyInstance, data: HypercashTransactionEventData) {
  const txData = data.transaction;
  if (!txData?.paymentLinkId || !txData?.status) return false;

  const charge = await prisma.hypercashUpgradeCharge.findUnique({ where: { paymentLinkId: txData.paymentLinkId } });
  if (!charge) return false;

  if (charge.status === 'paid') return true; // reentrega - idempotente

  if (!PAID_UPGRADE_STATUSES.has(txData.status.toLowerCase())) return true; // pendente/falhou - nada a fazer ainda

  await applyHypercashUpgrade(app, charge);
  return true;
}

export async function billingRoutes(app: FastifyInstance) {
  app.post<{ Body: WebhookBody; Querystring: Record<string, string> }>(
    '/billing/mercadopago/webhook',
    async (request, reply) => {
      const type = request.body?.type || request.query.type;
      // Query primeiro, corpo como fallback - é a ordem que a documentação da
      // Mercado Pago usa pro id que entra no cálculo da assinatura; inverter
      // isso arrisca calcular o HMAC em cima do id errado e rejeitar um
      // webhook legítimo (que a Mercado Pago não teria como saber reenviar
      // de outro jeito, então ficaria rejeitado pra sempre).
      const dataId = request.query['data.id'] || request.body?.data?.id;

      if (!dataId || (type !== 'subscription_preapproval' && type !== 'payment')) {
        return reply.send({ received: true });
      }

      const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
      if (!secret) {
        app.log.error('MERCADOPAGO_WEBHOOK_SECRET não configurada — recusando webhook da Mercado Pago.');
        return reply.status(500).send({ message: 'Servidor não configurado para validar webhooks.' });
      }
      const ok = verifySignature(
        request.headers['x-signature'] as string | undefined,
        request.headers['x-request-id'] as string | undefined,
        dataId,
        secret
      );
      if (!ok) {
        return reply.status(401).send({ message: 'Assinatura inválida.' });
      }

      try {
        if (type === 'subscription_preapproval') {
          await handlePreapprovalEvent(dataId);
        } else {
          await handlePaymentEvent(app, dataId);
        }
      } catch (err) {
        app.log.error(err);
        // Antes só virava log do Railway, que ninguém ficava olhando - um
        // pagamento que falha silenciosamente é caro demais pra depender de
        // alguém notar por acaso. Não trava a resposta no envio do e-mail
        // (erro aqui não pode transformar um 500 legítimo em outro erro).
        sendOpsAlertEmail(
          app,
          `Falha ao processar webhook da Mercado Pago (${type})`,
          `type: ${type}\ndata.id: ${dataId}\nerro: ${err instanceof Error ? err.message : String(err)}`
        ).catch(() => {});
        // 500 em vez de engolir o erro - assim a Mercado Pago reentrega o
        // webhook depois de uma falha transitória (rede, DB, timeout) em vez
        // de considerar entregue um evento que na prática não foi processado.
        return reply.status(500).send({ message: 'Falha ao processar o webhook.' });
      }

      return reply.send({ received: true });
    }
  );

  app.get('/billing/pix/current', { onRequest: [app.authenticate] }, async (request, reply) => {
    try {
      const pix = await ensureCurrentPixCharge(request.user.sub);
      return reply.send({ pix });
    } catch (err) {
      app.log.error(err);
      // Esse é o pior caso de todos: cliente que JÁ PAGA tentando renovar o
      // ciclo e não consegue - mesmo alerta das falhas de cobrança nova em
      // plans/routes.ts, aqui ainda mais crítico.
      sendOpsAlertEmail(
        app,
        'Falha ao gerar cobrança Pix de renovação (Mercado Pago)',
        `userId: ${request.user.sub}\nerro: ${err instanceof Error ? err.message : String(err)}`
      ).catch(() => {});
      return reply.status(502).send({ message: 'Não foi possível verificar o Pix agora. Tente novamente em instantes.' });
    }
  });

  // Assinatura confirmada ao vivo contra um evento de teste real da
  // HyperCash (o painel deles não documenta isso publicamente) - ver
  // lib/hypercash-webhook.ts. Captura do corpo bruto necessária pra validar
  // (mesma pegadinha do push da Shopee: "application/json" precisa de
  // parser explícito além do "*", senão o parser padrão do Fastify toma a
  // frente e o rawBody nunca é preenchido).
  const captureRawBody = (req: unknown, body: unknown, done: (err: Error | null, body?: unknown) => void) => {
    (req as { rawBody?: string }).rawBody = body as string;
    try {
      done(null, (body as string).length > 0 ? JSON.parse(body as string) : {});
    } catch {
      done(null, {});
    }
  };
  app.addContentTypeParser('application/json', { parseAs: 'string' }, captureRawBody);
  app.addContentTypeParser('*', { parseAs: 'string' }, captureRawBody);

  app.post<{ Body: { type?: string; data?: HypercashSubscriptionEventData & HypercashTransactionEventData } }>(
    '/billing/hypercash/webhook',
    async (request, reply) => {
      const rawBody = (request as typeof request & { rawBody?: string }).rawBody ?? '';
      const secret = process.env.HYPERCASH_WEBHOOK_SECRET;
      if (!secret) {
        app.log.error('HYPERCASH_WEBHOOK_SECRET não configurada — recusando webhook da HyperCash.');
        return reply.status(500).send({ message: 'Servidor não configurado para validar webhooks.' });
      }

      const sigHeader = request.headers['x-hypercash-signature'] as string | undefined;
      if (!verifyHypercashSignature(sigHeader, rawBody, secret)) {
        return reply.status(401).send({ message: 'Assinatura inválida.' });
      }

      const type = request.body?.type;
      if (type === 'subscription.test') {
        return reply.send({ received: true });
      }

      try {
        const data = request.body?.data ?? {};
        // Tenta assinatura primeiro, depois cobrança avulsa de upgrade - os
        // dois formatos são mutuamente exclusivos (um evento nunca tem os
        // dois), então só um dos dois reconhece o payload de cada vez.
        const processed = (await handleHypercashSubscriptionEvent(app, data)) || (await handleHypercashUpgradeChargeEvent(app, data));
        if (!processed) {
          // Formato que não reconhecemos (nem "subscription.test", nem
          // assinatura, nem cobrança de upgrade) - alerta em vez de ignorar
          // silenciosamente, igual já fazíamos antes de processar de verdade.
          sendOpsAlertEmail(
            app,
            `[HyperCash] Webhook com formato não reconhecido: ${type}`,
            `raw body: ${rawBody}`
          ).catch(() => {});
        }
      } catch (err) {
        app.log.error(err);
        sendOpsAlertEmail(
          app,
          `[HyperCash] Falha ao processar webhook: ${type}`,
          `erro: ${err instanceof Error ? err.message : String(err)}\n\nraw body: ${rawBody}`
        ).catch(() => {});
        // 500 pra HyperCash reentregar depois (mesmo princípio do handler da
        // Mercado Pago) em vez de considerar entregue um evento que não foi
        // processado de verdade.
        return reply.status(500).send({ message: 'Falha ao processar o webhook.' });
      }

      return reply.send({ received: true });
    }
  );
}
