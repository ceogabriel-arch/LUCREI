import type { Plan, User } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { serializeUser } from './serialize-user';

type UserWithPlan = User & { plan: Plan | null };

function buildUser(overrides: Partial<UserWithPlan> = {}): UserWithPlan {
  return {
    id: 'user_1',
    email: 'ana@example.com',
    passwordHash: 'super-secret-hash',
    name: 'Ana',
    subscriptionStatus: 'trialing',
    planId: null,
    document: null,
    trialEndsAt: null,
    passwordResetTokenHash: null,
    passwordResetTokenExpiresAt: null,
    tokenVersion: 0,
    pushToken: null,
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
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as Plan;
}

describe('serializeUser', () => {
  it('never leaks the password hash', () => {
    const result = serializeUser(buildUser());
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('returns plan: null when the user has no plan linked', () => {
    const result = serializeUser(buildUser({ plan: null }));
    expect(result.plan).toBeNull();
  });

  it('exposes only key and name from the linked plan', () => {
    const result = serializeUser(buildUser({ planId: 'plan_pro', plan: buildPlan() }));
    expect(result.plan).toEqual({ key: 'pro', name: 'Pro' });
  });

  it('passes through the subscription status as-is', () => {
    const result = serializeUser(buildUser({ subscriptionStatus: 'canceled' }));
    expect(result.subscriptionStatus).toBe('canceled');
  });
});
