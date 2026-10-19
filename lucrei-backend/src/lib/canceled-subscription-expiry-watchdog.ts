import type { FastifyBaseLogger } from 'fastify';

import { prisma } from './prisma';

// Achado ao vivo (19/10): cancelar hoje já para a cobrança recorrente na
// HyperCash certinho, sem mexer no plano - a pessoa continua com acesso até
// o fim do período já pago, que é o comportamento certo. O problema é
// DEPOIS disso: subscriptionStatus fica 'canceled' pra sempre, e
// getSubscriptionAccessStatus (subscription-access.ts) só bloqueia acesso
// quando o status é 'past_due' - 'canceled' nunca entra nessa checagem.
// Resultado: quem cancela fica com acesso ilimitado de graça pra sempre,
// bem depois do período pago acabar. Esse watchdog fecha essa lacuna -
// mesma ideia do trial-expiry-watchdog (também vira 'past_due', reaproveita
// a carência de SUBSCRIPTION_GRACE_DAYS que já existe pra pagamento
// atrasado, em vez de bloquear na hora sem nenhum aviso). Só mexe em
// User.subscriptionStatus, nunca em Subscription.status - mudar o status da
// Subscription de volta de 'canceled' faria /plans/select (que procura por
// "status !== 'canceled'") achar e tentar reaproveitar uma assinatura morta
// na próxima vez que a pessoa assinar de novo.
const WATCHDOG_INTERVAL_MS = 60 * 60 * 1000;

export function isCanceledSubscriptionExpired(
  user: { subscriptionStatus: string },
  subscription: { currentPeriodEnd: Date | null; createdAt: Date } | null,
  now = Date.now()
): boolean {
  if (user.subscriptionStatus !== 'canceled') return false;
  const periodEnd = subscription?.currentPeriodEnd ?? subscription?.createdAt ?? null;
  if (!periodEnd) return false;
  return periodEnd.getTime() <= now;
}

export async function expireCanceledSubscriptions(logger?: FastifyBaseLogger): Promise<number> {
  const now = Date.now();
  const candidates = await prisma.user.findMany({
    where: { subscriptionStatus: 'canceled' },
    select: { id: true, subscriptionStatus: true },
  });
  if (candidates.length === 0) return 0;

  let expired = 0;
  for (const user of candidates) {
    // Mesma assinatura mais recente (de qualquer status) que
    // getSubscriptionAccessStatus usa como fallback quando todas estão
    // canceladas - a mesma data "desde quando" precisa valer nos dois
    // lugares, senão a carência calculada aqui e a calculada lá na hora de
    // bloquear de verdade discordariam entre si.
    const subscription = await prisma.subscription.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { currentPeriodEnd: true, createdAt: true },
    });
    if (!isCanceledSubscriptionExpired(user, subscription, now)) continue;

    await prisma.user.update({ where: { id: user.id }, data: { subscriptionStatus: 'past_due' } });
    expired++;
    logger?.warn({ userId: user.id }, 'watchdog: assinatura cancelada com período pago já encerrado - marcado como past_due');
  }

  return expired;
}

export function startCanceledSubscriptionExpiryWatchdog(logger: FastifyBaseLogger): void {
  const run = () => {
    expireCanceledSubscriptions(logger).catch((err) => {
      logger.error({ err }, 'watchdog: falha ao verificar assinaturas canceladas vencidas');
    });
  };
  run();
  setInterval(run, WATCHDOG_INTERVAL_MS).unref();
}
