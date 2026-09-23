import type { Plan, User } from '@prisma/client';

import { getSubscriptionAccessStatus } from '../../lib/subscription-access';

export const userWithPlan = { plan: true } as const;

type UserWithPlan = User & { plan: Plan | null };

export async function serializeUser(user: UserWithPlan) {
  // Curto-circuita sem consultar o banco pra quem não está em past_due (a
  // grande maioria) - só entra na consulta de assinatura pra quem realmente
  // precisa.
  const access = await getSubscriptionAccessStatus(user);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    hasPassword: user.hasPassword,
    createdAt: user.createdAt,
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt,
    // Espelha getSalesLimitStatus: "blocked" trava sync de verdade,
    // "graceDaysLeft" é só informativo pro app mostrar contagem regressiva.
    subscriptionBlocked: access.blocked,
    subscriptionGraceDaysLeft: access.graceDaysLeft,
    plan: user.plan
      ? {
          key: user.plan.key,
          name: user.plan.name,
          salesLimit: user.plan.salesLimit,
          billingPeriod: user.plan.billingPeriod,
        }
      : null,
  };
}
