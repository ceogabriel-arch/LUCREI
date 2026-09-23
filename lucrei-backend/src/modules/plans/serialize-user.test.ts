import type { Plan, User } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { serializeUser } from './serialize-user';

type UserWithPlan = User & { plan: Plan | null };

function buildUser(overrides: Partial<UserWithPlan> = {}): UserWithPlan {
  return {
    id: 'user_1',
    email: 'ana@example.com',
    passwordHash: 'super-secret-hash',
    hasPassword: true,
    name: 'Ana',
    subscriptionStatus: 'trialing',
    planId: null,
    document: null,
    trialEndsAt: null,
    passwordResetTokenHash: null,
    passwordResetTokenExpiresAt: null,
    tokenVersion: 0,
    pushToken: null,
    googleId: null,
    salesLimitWarnedAt: null,
    salesLimitReachedAt: null,
    trialEndingWarnedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    plan: null,
    ...overrides,
  };
}

function buildPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan_pro',
    key: 'pro',
    name: 'Pro',
    salesLimit: 1500,
    integrationsLimit: 1,
    priceOriginal: null,
    priceCurrent: null,
    sortOrder: 2,
    groupKey: 'pro',
    billingPeriod: 'monthly',
    trialEligible: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as Plan;
}

describe('serializeUser', () => {
  it('never leaks the password hash', async () => {
    const result = await serializeUser(buildUser());
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('returns plan: null when the user has no plan linked', async () => {
    const result = await serializeUser(buildUser({ plan: null }));
    expect(result.plan).toBeNull();
  });

  it('exposes key, name, salesLimit, and billingPeriod from the linked plan', async () => {
    const result = await serializeUser(buildUser({ planId: 'plan_pro', plan: buildPlan() }));
    expect(result.plan).toEqual({ key: 'pro', name: 'Pro', salesLimit: 1500, billingPeriod: 'monthly' });
  });

  it('passes through the subscription status as-is', async () => {
    const result = await serializeUser(buildUser({ subscriptionStatus: 'canceled' }));
    expect(result.subscriptionStatus).toBe('canceled');
  });

  it('reports no block/grace when not past_due (no DB access needed)', async () => {
    const result = await serializeUser(buildUser({ subscriptionStatus: 'trialing' }));
    expect(result.subscriptionBlocked).toBe(false);
    expect(result.subscriptionGraceDaysLeft).toBeNull();
  });
});
