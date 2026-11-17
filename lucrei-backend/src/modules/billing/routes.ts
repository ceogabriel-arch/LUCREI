import crypto from 'node:crypto';

import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { pixChargeNeedsActivationRecovery, revokedAccessPeriodEnd, summarizeHypercashWebhook } from '../../lib/billing-rules';
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

// Marca a cobrança Pix como aprovada só se ainda não estava - guarda atômica
// contra o Mercado Pago reenviar o mesmo webhook (eles avisam que isso
// acontece): dois eventos quase simultâneos passariam os dois por uma
// checagem "status === 'approved'" feita antes de qualquer um gravar.
function claimPixCharge(tx: Prisma.TransactionClient, chargeId: string, extra: Prisma.PixChargeUpdateManyMutationInput = {}) {
  return tx.pixCharge.updateMany({
    where: { id: chargeId, status: { not: 'approved' } },
    data: { status: 'approved', paidAt: new Date(), ...extra },
  });
}

async function handleUpgradeChargePaid(app: FastifyInstance, charge: { id: string; subscriptionId: string; amount: unknown; targetPlanId: string }) {
  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { id: charge.subscriptionId } });
  const targetPlan = await prisma.plan.findUnique({ where: { id: charge.targetPlanId } });
  if (!targetPlan) {
    // O dinheiro já foi capturado (a cobrança chegou até aqui como aprovada)
    // mas não tem mais plano pra aplicar - precisa de reconciliação manual.
    // Marca como aprovada mesmo assim (o pagamento existiu) e alerta - não
    // tenta de novo sozinho, reprocessar não faria o plano voltar a existir.
    const claimed = await prisma.$transaction((tx) => claimPixCharge(tx, charge.id));
    if (claimed.count > 0) {
      app.log.error(
        { chargeId: charge.id, targetPlanId: charge.targetPlanId },
        'Cobrança de upgrade aprovada mas o plano de destino não existe mais - upgrade não aplicado.'
      );
      sendOpsAlertEmail(
        app,
        'Upgrade Pix pago sem plano de destino válido',
        `chargeId: ${charge.id}\ntargetPlanId: ${charge.targetPlanId}`
      ).catch(() => {});
    }
    return;
  }

  // Assinatura por cartão continua cobrando na renovação anual - sem
  // atualizar o valor lá antes de aplicar o plano novo aqui, o cliente ficaria
  // com os recursos do plano caro mas continuaria sendo cobrado o valor do
  // plano antigo pra sempre. Só aplica o plano localmente depois de confirmar
  // que a Mercado Pago aceitou o novo valor. Feito ANTES de marcar a cobrança
  // como aprovada: antes ela já ficava 'approved' e a falha aqui só virava
  // log + 200 - o reenvio parava no "já aprovada" e o upgrade pago nunca era
  // aplicado. Agora a falha sobe como erro: o handler do webhook manda o
  // alerta de ops e devolve 500, e a Mercado Pago reentrega (atualizar o
  // valor de novo é idempotente - mesmo valor).
  if (subscription.provider === 'mercado_pago' && subscription.providerSubscriptionId && targetPlan.priceCurrent !== null) {
    try {
      await updatePreapprovalValue(subscription.providerSubscriptionId, Number(targetPlan.priceCurrent));
    } catch (err) {
      app.log.error(
        { err, subscriptionId: subscription.id, targetPlanId: targetPlan.id },
        'Falha ao atualizar o valor da assinatura no cartão após upgrade pago - plano NÃO aplicado, aguardando reentrega do webhook.'
      );
      throw new Error(
        `Upgrade pago (chargeId ${charge.id}, subscriptionId ${subscription.id}, plano ${targetPlan.key}) mas falhou ao atualizar o valor da assinatura no cartão - plano NÃO aplicado: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // Aprovação da cobrança e troca do plano na mesma transação - ou as duas
  // acontecem, ou nenhuma (e o reenvio do webhook tenta de novo).
  // previousPlanId guarda o plano de antes, pra desfazer o upgrade se essa
  // cobrança for estornada depois (ver handleChargeReversed).
  const user = await prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: subscription.userId } });
    const claimed = await claimPixCharge(tx, charge.id, { previousPlanId: before.planId });
    if (claimed.count === 0) return null;
    return tx.user.update({ where: { id: subscription.userId }, data: { planId: targetPlan.id } });
  });
  if (!user) return;

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
//
// Antes isso virava 'canceled', que mantém acesso até currentPeriodEnd + 7
// dias (é o mesmo status de quem cancelou a renovação com o ciclo pago) -
// quem pegou o dinheiro de volta seguia usando o ciclo estornado inteiro.
// Agora vira 'past_due' com a carência já esgotada (revokedAccessPeriodEnd):
// bloqueio na hora, pelas regras de acesso que já existem.
async function handleChargeReversed(
  app: FastifyInstance,
  charge: { id: string; subscriptionId: string; status: string; targetPlanId: string | null; previousPlanId: string | null },
  mpStatus: string
) {
  const wasApproved = charge.status === 'approved';

  // Estorno de uma cobrança de UPGRADE: o ciclo base continua pago (foi
  // outra cobrança), só o upgrade é desfeito - volta pro plano de antes.
  // Antes cancelava a assinatura inteira E deixava o plano caro aplicado.
  if (charge.targetPlanId) {
    const reverted = await prisma.$transaction(async (tx) => {
      const claimed = await tx.pixCharge.updateMany({ where: { id: charge.id, status: { not: 'canceled' } }, data: { status: 'canceled' } });
      if (claimed.count === 0 || !wasApproved || !charge.previousPlanId) return false;
      const subscription = await tx.subscription.findUniqueOrThrow({ where: { id: charge.subscriptionId } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: subscription.userId } });
      // Só desfaz se a conta ainda está no plano desse upgrade - se já trocou
      // de plano depois por outro caminho, não sobrescreve.
      if (user.planId !== charge.targetPlanId) return false;
      await tx.user.update({ where: { id: user.id }, data: { planId: charge.previousPlanId } });
      return true;
    });
    app.log.warn({ chargeId: charge.id, mpStatus, reverted }, 'Cobrança Pix de upgrade estornada/contestada pela Mercado Pago.');
    if (wasApproved) {
      // Sempre alerta: o valor da assinatura no cartão (updatePreapprovalValue)
      // continua no do plano novo e precisa ser conferido à mão; e cobranças
      // de upgrade aprovadas antes de previousPlanId existir não têm como ser
      // desfeitas sozinhas.
      sendOpsAlertEmail(
        app,
        'Upgrade Pix estornado/contestado',
        `chargeId: ${charge.id}\nsubscriptionId: ${charge.subscriptionId}\nstatus MP: ${mpStatus}\nplano revertido automaticamente: ${reverted ? 'sim' : 'NÃO - revisar à mão'}\nconferir o valor da assinatura no cartão.`
      ).catch(() => {});
    }
    return;
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.pixCharge.updateMany({ where: { id: charge.id, status: { not: 'canceled' } }, data: { status: 'canceled' } });
    // Cobrança que nunca tinha sido aprovada aqui não liberou acesso nenhum
    // - revogar puniria um ciclo anterior legitimamente pago.
    if (claimed.count === 0 || !wasApproved) return;
    const subscription = await tx.subscription.findUniqueOrThrow({ where: { id: charge.subscriptionId } });
    await tx.subscription.update({
      where: { id: subscription.id },
      // Assinatura já cancelada continua 'canceled' (mudar de volta faria
      // /plans/select tentar reaproveitar uma assinatura morta) - só a data
      // é recuada, e o usuário é que vira past_due.
      data: { ...(subscription.status === 'canceled' ? {} : { status: 'past_due' }), currentPeriodEnd: revokedAccessPeriodEnd() },
    });
    await tx.user.update({ where: { id: subscription.userId }, data: { subscriptionStatus: 'past_due' } });
  });
  app.log.warn({ chargeId: charge.id, mpStatus }, 'Pagamento Pix estornado/contestado pela Mercado Pago - acesso bloqueado (past_due).');
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

  if (payment.status !== 'approved') return;

  if (charge.targetPlanId) {
    if (charge.status === 'approved') return;
    await handleUpgradeChargePaid(app, { ...charge, targetPlanId: charge.targetPlanId });
    return;
  }

  // Aprovação da cobrança e ativação da assinatura+usuário numa transação
  // só. Antes a cobrança era marcada 'approved' ANTES da transação que
  // ativa - uma falha transitória no meio devolvia 500, mas o reenvio do
  // webhook parava no "já aprovada" e o cliente que pagou ficava preso em
  // past_due pra sempre. Agora, se qualquer escrita falhar, a aprovação
  // também é desfeita e a reentrega processa tudo de novo.
  const user = await prisma.$transaction(async (tx) => {
    const claimed = await claimPixCharge(tx, charge.id);
    const subscription = await tx.subscription.findUniqueOrThrow({ where: { id: charge.subscriptionId } });

    if (claimed.count === 0) {
      // Já aprovada antes: normalmente é só reentrega (no-op). Mas cobranças
      // que ficaram presas pelo bug acima (aprovadas sem a ativação gravada)
      // são recuperadas aqui no próximo reenvio.
      const newerCharge = await tx.pixCharge.findFirst({
        where: { subscriptionId: charge.subscriptionId, createdAt: { gt: charge.createdAt } },
        select: { id: true },
      });
      if (!pixChargeNeedsActivationRecovery(subscription, charge, Boolean(newerCharge))) return null;
      app.log.warn({ chargeId: charge.id }, 'Cobrança Pix aprovada sem ativação gravada - reprocessando ativação.');
    }

    await tx.subscription.update({
      where: { id: subscription.id },
      data: { status: 'active', currentPeriodEnd: charge.periodEnd },
    });
    return tx.user.update({
      where: { id: subscription.userId },
      data: { subscriptionStatus: 'active' },
    });
  });
  if (!user) return;

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
  const status = mapHypercashStatus(subData.status);

  if (!subscription) {
    // Antes era ignorado em silêncio - mas um link que não conhecemos
    // recebendo evento pode ser um cliente sendo cobrado sem a gente
    // registrar nada (ex: link antigo sobrescrito). Alerta pra conferir -
    // menos quando o evento é de cancelamento/expiração (ex: a assinatura
    // antiga que o próprio upgrade cancelou), que não cobra ninguém.
    if (status !== 'canceled') {
      sendOpsAlertEmail(
        app,
        '[HyperCash] Webhook de assinatura para link desconhecido',
        `paymentLinkId: ${subData.paymentLinkId}\nstatus HyperCash: ${subData.status}`
      ).catch(() => {});
    }
    return true;
  }

  // Já cancelamos essa assinatura por aqui - um webhook atrasado ou
  // reenviado não deve reativar ela sozinho (mesmo princípio do handler da
  // Mercado Pago). Mas se a HyperCash diz que ela está ATIVA, o cartão
  // continua sendo cobrado por algo que consideramos cancelado - alerta.
  if (subscription.status === 'canceled') {
    if (status === 'active') {
      sendOpsAlertEmail(
        app,
        '[HyperCash] Assinatura cancelada localmente mas ativa na HyperCash',
        `subscriptionId: ${subscription.id}\nuserId: ${subscription.userId}\npaymentLinkId: ${subData.paymentLinkId}\nconferir se o cartão continua sendo cobrado.`
      ).catch(() => {});
    }
    return true;
  }

  const nextPeriodEnd = subData.currentPeriodEnd ? new Date(subData.currentPeriodEnd) : undefined;

  const statusChanged = status !== subscription.status;
  const periodChanged =
    nextPeriodEnd !== undefined && nextPeriodEnd.getTime() !== (subscription.currentPeriodEnd?.getTime() ?? -1);
  // Plano escolhido em /plans/select que só vale depois de pago (ver
  // pendingPlanId no schema) - aplicado aqui, quando a HyperCash confirma.
  const applyPendingPlan = status === 'active' && subscription.pendingPlanId !== null;
  // Reentrega do mesmo evento (a HyperCash pode reenviar, como a Mercado
  // Pago já faz) vira um no-op aqui - idempotente sem precisar de guarda
  // explícita, já que só grava quando algo de fato mudou.
  if (!statusChanged && !periodChanged && !applyPendingPlan) return true;

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        ...(statusChanged ? { status } : {}),
        ...(periodChanged ? { currentPeriodEnd: nextPeriodEnd } : {}),
        ...(applyPendingPlan ? { pendingPlanId: null } : {}),
      },
    }),
    ...(statusChanged || applyPendingPlan
      ? [
          prisma.user.update({
            where: { id: subscription.userId },
            data: {
              ...(statusChanged ? { subscriptionStatus: status } : {}),
              ...(applyPendingPlan ? { planId: subscription.pendingPlanId } : {}),
            },
          }),
        ]
      : []),
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
    prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'past_due',
        providerSubscriptionId: link?.id ?? null,
        lastInvoiceUrl: link?.checkoutUrl ?? null,
        // Plano já pago (pelo upgrade) - nada mais pendente nessa assinatura.
        pendingPlanId: null,
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

  // Guarda atômica ANTES de qualquer efeito colateral (mesmo princípio do
  // caminho da Mercado Pago) - só a checagem "status === 'paid'" acima
  // deixava dois webhooks simultâneos passarem os dois e aplicarem o upgrade
  // 2x (2 links de assinatura novos, cancelamento duplicado).
  const claimed = await prisma.hypercashUpgradeCharge.updateMany({
    where: { id: charge.id, status: { not: 'paid' } },
    data: { status: 'paid', paidAt: new Date() },
  });
  if (claimed.count === 0) return true;

  try {
    await applyHypercashUpgrade(app, charge);
  } catch (err) {
    // Desfaz a reserva pra reentrega do webhook (500 lá em cima) conseguir
    // aplicar de novo - sem isso o upgrade pago ficaria marcado 'paid' e
    // nunca seria aplicado.
    await prisma.hypercashUpgradeCharge
      .update({ where: { id: charge.id }, data: { status: charge.status, paidAt: null } })
      .catch((revertErr) => app.log.error({ err: revertErr, chargeId: charge.id }, 'Falha ao desfazer reserva da cobrança de upgrade HyperCash.'));
    throw err;
  }
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
          // Só ids/status/valor - o corpo bruto tem dados pessoais do pagador
          // (nome, e-mail, documento) que não devem ir pra e-mail de alerta.
          sendOpsAlertEmail(
            app,
            `[HyperCash] Webhook com formato não reconhecido: ${type}`,
            summarizeHypercashWebhook(request.body)
          ).catch(() => {});
        }
      } catch (err) {
        app.log.error(err);
        sendOpsAlertEmail(
          app,
          `[HyperCash] Falha ao processar webhook: ${type}`,
          `erro: ${err instanceof Error ? err.message : String(err)}\n\n${summarizeHypercashWebhook(request.body)}`
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
