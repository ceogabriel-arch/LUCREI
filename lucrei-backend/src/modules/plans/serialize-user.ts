import type { Plan, User } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { getSubscriptionAccessStatus } from '../../lib/subscription-access';

export const userWithPlan = { plan: true } as const;

type UserWithPlan = User & { plan: Plan | null };

export async function serializeUser(user: UserWithPlan) {
  // Curto-circuita sem consultar o banco pra quem não está em past_due (a
  // grande maioria) - só entra na consulta de assinatura pra quem realmente
  // precisa.
  const access = await getSubscriptionAccessStatus(user);

  // Mesmo padrão de "achar a assinatura atual" de getSubscriptionAccessStatus
  // - sem isso o app não tinha como saber que um cupom já estava preso numa
  // assinatura (reclamado ao vivo: cliente reaplicando o cupom via Pix via a
  // tela rejeitar "já usado" sem nunca mostrar que o desconto já estava lá).
  const subscription = await prisma.subscription.findFirst({
    where: { userId: user.id, status: { not: 'canceled' } },
    orderBy: { createdAt: 'desc' },
  });

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    hasPassword: user.hasPassword,
    createdAt: user.createdAt,
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt,
    dailyProfitGoal: user.dailyProfitGoal != null ? Number(user.dailyProfitGoal) : null,
    // Espelha getSalesLimitStatus: "blocked" trava sync de verdade,
    // "graceDaysLeft" é só informativo pro app mostrar contagem regressiva.
    subscriptionBlocked: access.blocked,
    subscriptionGraceDaysLeft: access.graceDaysLeft,
    // % de desconto já preso na assinatura atual, esperando a 1ª cobrança -
    // null quando não tem cupom pendente nenhum.
    pendingCouponPercentOff: subscription?.pendingCouponPercentOff ?? null,
    plan: user.plan
      ? {
          key: user.plan.key,
          name: user.plan.name,
          // Limite efetivo da conta, não só o do plano - respeita
          // salesLimitOverride quando preenchido (ver sales-usage.ts).
          salesLimit: user.salesLimitOverride ?? user.plan.salesLimit,
          billingPeriod: user.plan.billingPeriod,
        }
      : null,
  };
}
