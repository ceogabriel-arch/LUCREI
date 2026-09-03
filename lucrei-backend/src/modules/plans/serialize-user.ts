import type { Plan, User } from '@prisma/client';

export const userWithPlan = { plan: true } as const;

type UserWithPlan = User & { plan: Plan | null };

export function serializeUser(user: UserWithPlan) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    subscriptionStatus: user.subscriptionStatus,
    trialEndsAt: user.trialEndsAt,
    plan: user.plan ? { key: user.plan.key, name: user.plan.name } : null,
  };
}
