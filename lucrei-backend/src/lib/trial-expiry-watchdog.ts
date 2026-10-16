import type { FastifyBaseLogger } from 'fastify';

import { prisma } from './prisma';

// Achado ao vivo (16/10): teste grátis acabando (trialEndsAt no passado) não
// bloqueava NADA sozinho - subscriptionStatus só sai de 'trialing' quando a
// pessoa volta em /plans/select (ver plans/routes.ts). Quem nunca mais
// assinou (sem cartão, nunca pagou nada) ficava com acesso liberado pra
// sempre. getSubscriptionAccessStatus (subscription-access.ts) só bloqueia
// quando subscriptionStatus === 'past_due' - esse watchdog é quem agora faz
// essa transição sozinho, sem depender de a pessoa voltar no app.
const WATCHDOG_INTERVAL_MS = 60 * 60 * 1000;

export function isTrialExpired(user: { subscriptionStatus: string; trialEndsAt: Date | null }, now = Date.now()): boolean {
  if (user.subscriptionStatus !== 'trialing') return false;
  if (!user.trialEndsAt) return false;
  return user.trialEndsAt.getTime() <= now;
}

// Vira 'past_due' (não 'canceled') de propósito - reaproveita a mesma
// carência de SUBSCRIPTION_GRACE_DAYS já usada pra pagamento atrasado
// (subscription-access.ts), contada a partir de currentPeriodEnd da
// assinatura 'trialing' (que já é o próprio trialEndsAt, ver
// plans/routes.ts), então o relógio da carência já começa certo, sem
// precisar de nenhuma coluna nova.
export async function expireStaleTrials(logger?: FastifyBaseLogger): Promise<number> {
  const now = Date.now();
  const candidates = await prisma.user.findMany({
    where: {
      subscriptionStatus: 'trialing',
      trialEndsAt: { lte: new Date(now) },
    },
  });

  let expired = 0;
  for (const user of candidates) {
    if (!isTrialExpired(user, now)) continue;

    await prisma.user.update({
      where: { id: user.id },
      data: { subscriptionStatus: 'past_due' },
    });
    expired++;
    logger?.warn({ userId: user.id }, 'watchdog: teste grátis expirado sem assinatura - marcado como past_due');
  }

  return expired;
}

export function startTrialExpiryWatchdog(logger: FastifyBaseLogger): void {
  const run = () => {
    expireStaleTrials(logger).catch((err) => {
      logger.error({ err }, 'watchdog: falha ao verificar testes grátis expirados');
    });
  };
  run();
  setInterval(run, WATCHDOG_INTERVAL_MS).unref();
}
