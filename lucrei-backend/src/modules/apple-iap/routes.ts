import type { FastifyInstance } from 'fastify';
import { Status, VerificationException, type JWSTransactionDecodedPayload } from '@apple/app-store-server-library';

import { sendOpsAlertEmail } from '../../lib/email';
import {
  expiresDateToDate,
  getOrCreateAppleAppAccountToken,
  planKeyForAppleProduct,
  verifyAppleNotification,
  verifyAppleTransaction,
} from '../../lib/apple-iap';
import { resolveAppleTransactionStatus, revokedAccessPeriodEnd } from '../../lib/billing-rules';
import { prisma } from '../../lib/prisma';
import { sendPushNotification } from '../../lib/push-notifications';
import { serializeUser, userWithPlan } from '../plans/serialize-user';

const BUNDLE_ID = 'com.lucreiapp.mobile';

// rejected = transação válida mas que não deve liberar nada (vencida ou
// reembolsada) - não é falha nossa, não precisa alertar ops.
type ApplyResult = { applied: true } | { applied: false; reason: string; rejected?: boolean };

/**
 * Aplica uma transação da Apple já verificada (chamada tanto pela compra
 * síncrona no app quanto pelo webhook de renovação/cancelamento) - mesmo
 * papel que handlePaymentEvent/handleHypercashSubscriptionEvent já têm pra
 * HyperCash/Mercado Pago (subscription-sync.ts / billing/routes.ts), só que
 * aqui "escolher o plano" e "confirmar o pagamento" são o mesmo instante
 * (a compra no StoreKit já é a cobrança).
 *
 * status 'active' só reatribui o plano do usuário (user.planId) - uma
 * renovação/cancelamento não deveria apagar o plano "de registro" de uma
 * assinatura mais nova, mesmo padrão das outras integrações (nenhuma delas
 * toca em planId ao só cancelar).
 */
async function applyAppleTransaction(
  app: FastifyInstance,
  transaction: JWSTransactionDecodedPayload,
  explicitStatus?: Status
): Promise<ApplyResult> {
  const { productId, originalTransactionId, appAccountToken } = transaction;
  if (!originalTransactionId) return { applied: false, reason: 'sem originalTransactionId' };

  const planKey = planKeyForAppleProduct(productId);
  if (!planKey) return { applied: false, reason: `productId desconhecido: ${productId}` };

  const plan = await prisma.plan.findUnique({ where: { key: planKey } });
  if (!plan) return { applied: false, reason: `plano "${planKey}" não existe mais no banco` };

  let subscription = await prisma.subscription.findFirst({
    where: { provider: 'apple_iap', providerSubscriptionId: originalTransactionId },
  });

  let userId = subscription?.userId;
  if (!userId) {
    if (!appAccountToken) return { applied: false, reason: 'sem appAccountToken e sem assinatura local existente' };
    const user = await prisma.user.findUnique({ where: { appleAppAccountToken: appAccountToken } });
    if (!user) return { applied: false, reason: `nenhuma conta com appleAppAccountToken=${appAccountToken}` };
    userId = user.id;
  }

  const txPeriodEnd = expiresDateToDate(transaction.expiresDate);

  // Transação mais velha do que o período já gravado (JWS antigo reenviado,
  // ou notificação atrasada de um ciclo anterior) - não pode fazer o estado
  // andar pra trás nem reabrir acesso. Ignora sem erro.
  if (subscription?.currentPeriodEnd && txPeriodEnd && txPeriodEnd.getTime() < subscription.currentPeriodEnd.getTime()) {
    app.log.warn({ originalTransactionId, subscriptionId: subscription.id }, 'Transação Apple mais antiga que o período já gravado - ignorada.');
    return { applied: true };
  }

  // Antes, sem status explícito (compra síncrona do app) a conta virava
  // 'active' sem olhar expiresDate/revocationDate - reenviar um JWS antigo
  // (assinado de verdade) de uma assinatura já vencida reabria o acesso pra
  // sempre. Ver resolveAppleTransactionStatus.
  const resolved = resolveAppleTransactionStatus({
    explicitStatus,
    expiresDate: transaction.expiresDate,
    revocationDate: transaction.revocationDate,
  });
  // Compra síncrona (sem status explícito) de algo já vencido/reembolsado:
  // recusa sem mexer em nada - não é uma compra nova, e gravar 'canceled'
  // aqui poderia sobrescrever o status de uma assinatura de outro provedor.
  if (explicitStatus === undefined && resolved.kind !== 'ok') {
    return { applied: false, rejected: true, reason: resolved.kind === 'revoked' ? 'transação reembolsada/revogada' : 'assinatura já expirada' };
  }
  // O JWS que o app manda é o mesmo de antes de um reembolso (a Apple não
  // reemite ele com revocationDate pro aparelho) - reenviar ele depois do
  // webhook de REVOKED/EXPIRED reabriria o acesso. Compra síncrona só pode
  // reativar uma assinatura local não-ativa com uma transação FEITA DEPOIS
  // da última mudança de estado registrada (assinou de novo / renovou).
  if (
    explicitStatus === undefined &&
    subscription &&
    subscription.status !== 'active' &&
    (transaction.purchaseDate ?? 0) <= subscription.updatedAt.getTime()
  ) {
    return { applied: false, rejected: true, reason: 'transação anterior ao último estado registrado da assinatura' };
  }

  // Reembolso/revogação pela Apple: antes virava 'canceled', que mantém
  // acesso até currentPeriodEnd + 7 dias. Agora 'past_due' com a carência já
  // esgotada (revokedAccessPeriodEnd) - bloqueio na hora, mesmo critério do
  // estorno de Pix (billing/routes.ts).
  const status = resolved.kind === 'ok' ? resolved.status : 'past_due';
  const currentPeriodEnd = resolved.kind === 'revoked' ? revokedAccessPeriodEnd() : txPeriodEnd;

  if (!subscription) {
    subscription = await prisma.subscription.create({
      data: { userId, provider: 'apple_iap', providerSubscriptionId: originalTransactionId, status, currentPeriodEnd },
    });
  } else {
    const statusChanged = status !== subscription.status;
    const periodChanged = currentPeriodEnd !== null && currentPeriodEnd.getTime() !== (subscription.currentPeriodEnd?.getTime() ?? -1);
    if (statusChanged || periodChanged) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { ...(statusChanged ? { status } : {}), ...(periodChanged ? { currentPeriodEnd } : {}) },
      });
    }
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const planChanged = status === 'active' && user.planId !== plan.id;
  const statusChangedOnUser = user.subscriptionStatus !== status;

  if (planChanged || statusChangedOnUser) {
    await prisma.user.update({
      where: { id: userId },
      data: { subscriptionStatus: status, ...(planChanged ? { planId: plan.id } : {}) },
    });
  }

  if (planChanged && user.pushToken) {
    sendPushNotification(user.pushToken, 'Pagamento confirmado! 🎉', `Você agora está no plano ${plan.name}.`).catch((err) =>
      app.log.error(err)
    );
  }

  return { applied: true };
}

export async function appleIapRoutes(app: FastifyInstance) {
  // Chamado pelo app ANTES de iniciar a compra no StoreKit - o token
  // devolvido aqui é o que vai como appAccountToken na compra, pra toda
  // transação/notificação dessa assinatura voltar sabendo de qual conta
  // Lucrei se trata.
  app.get('/billing/apple/app-account-token', { onRequest: [app.authenticate] }, async (request, reply) => {
    const token = await getOrCreateAppleAppAccountToken(request.user.sub);
    return reply.send({ token });
  });

  app.post<{ Body: { signedTransactionInfo?: string } }>(
    '/billing/apple/verify-purchase',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { signedTransactionInfo } = request.body;
      if (!signedTransactionInfo) {
        return reply.status(400).send({ message: 'signedTransactionInfo é obrigatório.' });
      }

      let transaction: JWSTransactionDecodedPayload;
      try {
        transaction = await verifyAppleTransaction(signedTransactionInfo);
      } catch (err) {
        app.log.error(err);
        return reply.status(401).send({ message: 'Não foi possível verificar a compra com a Apple.' });
      }

      if (transaction.bundleId !== BUNDLE_ID) {
        return reply.status(401).send({ message: 'Transação de outro app.' });
      }

      // appAccountToken ausente só deveria acontecer numa compra iniciada
      // antes dessa conta ter passado por /app-account-token (não devia
      // ocorrer no fluxo normal do app) - segue mesmo assim confiando no
      // usuário autenticado, mas não deixa passar uma transação que
      // claramente pertence a OUTRA conta (token presente e diferente).
      const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub } });
      if (transaction.appAccountToken && transaction.appAccountToken !== user.appleAppAccountToken) {
        app.log.error(
          { userId: user.id, transactionAppAccountToken: transaction.appAccountToken },
          'Transação Apple com appAccountToken de outra conta - recusada.'
        );
        return reply.status(409).send({ message: 'Essa compra pertence a outra conta.' });
      }

      const result = await applyAppleTransaction(app, transaction);
      if (!result.applied && result.rejected) {
        return reply.status(409).send({ message: 'Essa assinatura da App Store já expirou ou foi reembolsada.' });
      }
      if (!result.applied) {
        app.log.error({ reason: result.reason, transaction }, 'Falha ao aplicar transação Apple verificada.');
        sendOpsAlertEmail(app, 'Falha ao aplicar compra Apple IAP', `userId: ${request.user.sub}\nmotivo: ${result.reason}`).catch(
          () => {}
        );
        return reply.status(502).send({ message: 'Compra confirmada pela Apple, mas não foi possível aplicar o plano. Nosso time já foi avisado.' });
      }

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: request.user.sub }, include: userWithPlan });
      return reply.send(await serializeUser(updated));
    }
  );

  // App Store Server Notifications V2 - renovação, cancelamento, reembolso,
  // etc. Mesmo princípio dos outros webhooks (billing/routes.ts): confia no
  // campo de status assinado pela própria Apple como fonte da verdade, não
  // no nome do evento.
  app.post<{ Body: { signedPayload?: string } }>('/billing/apple/webhook', async (request, reply) => {
    const { signedPayload } = request.body;
    if (!signedPayload) {
      return reply.send({ received: true });
    }

    let notification;
    try {
      notification = await verifyAppleNotification(signedPayload);
    } catch (err) {
      if (err instanceof VerificationException) {
        return reply.status(401).send({ message: 'Assinatura inválida.' });
      }
      throw err;
    }

    if (notification.notificationType === 'TEST') {
      return reply.send({ received: true });
    }

    const data = notification.data;
    // Notificação sem transação (CONSUMPTION_REQUEST, EXTERNAL_PURCHASE_TOKEN,
    // RENEWAL_EXTENDED em massa, etc.) - nenhuma delas afeta o status de
    // assinatura que a gente rastreia, ignora sem alertar.
    if (!data?.signedTransactionInfo || typeof data.status !== 'number') {
      return reply.send({ received: true });
    }

    try {
      const transaction = await verifyAppleTransaction(data.signedTransactionInfo);
      const result = await applyAppleTransaction(app, transaction, data.status);
      if (!result.applied) {
        // Reentrega (retry da própria Apple) de um evento que já falhou antes
        // continuaria falhando pelo mesmo motivo - aqui, diferente dos outros
        // webhooks, isso quase sempre é "conta nunca gerou appAccountToken"
        // (assinatura feita fora do fluxo atual) e não "falha transitória",
        // por isso vira 200 + alerta em vez de 500 (não adianta a Apple reentregar).
        app.log.error({ reason: result.reason, notificationType: notification.notificationType }, 'Notificação Apple não aplicada.');
        sendOpsAlertEmail(
          app,
          '[Apple IAP] Notificação não aplicada',
          `notificationType: ${notification.notificationType}\nmotivo: ${result.reason}`
        ).catch(() => {});
      }
    } catch (err) {
      app.log.error(err);
      sendOpsAlertEmail(
        app,
        `[Apple IAP] Falha ao processar webhook: ${notification.notificationType}`,
        `erro: ${err instanceof Error ? err.message : String(err)}`
      ).catch(() => {});
      return reply.status(500).send({ message: 'Falha ao processar o webhook.' });
    }

    return reply.send({ received: true });
  });
}
