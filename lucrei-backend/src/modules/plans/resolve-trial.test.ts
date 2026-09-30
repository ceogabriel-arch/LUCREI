import type { Plan, User } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { shop: { findFirst: vi.fn() } },
}));

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }));

import { resolveTrial } from './routes';

function buildUser(overrides: Partial<User> = {}): User {
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
    ...overrides,
  } as User;
}

function buildPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan_start',
    key: 'start',
    name: 'Start',
    salesLimit: 100,
    integrationsLimit: 1,
    priceOriginal: null,
    priceCurrent: 49.9 as unknown as Plan['priceCurrent'],
    sortOrder: 1,
    groupKey: 'start',
    billingPeriod: 'monthly',
    trialEligible: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as Plan;
}

describe('resolveTrial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserva um teste já em andamento em vez de encerrar na hora (bug ao vivo: escolher Pix/Cartão durante o teste)', async () => {
    const trialEndsAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 dias restantes
    const user = buildUser({ subscriptionStatus: 'trialing', trialEndsAt });

    const result = await resolveTrial(user, buildPlan());

    expect(result.eligibleForTrial).toBe(true);
    expect(result.trialEndsAt).toEqual(trialEndsAt);
    expect(result.trialDays).toBe(10);
    // Não deveria nem consultar loja "tainted" nesse caminho - o teste em
    // andamento já resolve sozinho, sem depender do histórico de lojas.
    expect(prismaMock.shop.findFirst).not.toHaveBeenCalled();
  });

  it('concede um teste novo completo pra quem nunca teve trialEndsAt', async () => {
    const user = buildUser({ subscriptionStatus: 'trialing', trialEndsAt: null });
    prismaMock.shop.findFirst.mockResolvedValue(null);

    const result = await resolveTrial(user, buildPlan());

    expect(result.eligibleForTrial).toBe(true);
    expect(result.trialDays).toBe(15);
    expect(result.trialEndsAt).not.toBeNull();
  });

  it('não concede novo teste pra quem já usou (trialEndsAt no passado, teste encerrado)', async () => {
    const pastTrialEnd = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const user = buildUser({ subscriptionStatus: 'past_due', trialEndsAt: pastTrialEnd });

    const result = await resolveTrial(user, buildPlan());

    expect(result.eligibleForTrial).toBe(false);
    expect(result.trialDays).toBe(0);
    expect(result.trialEndsAt).toEqual(pastTrialEnd);
  });

  it('não concede teste quando alguma loja da conta já consumiu teste em outra conta', async () => {
    const user = buildUser({ subscriptionStatus: 'trialing', trialEndsAt: null });
    prismaMock.shop.findFirst.mockResolvedValue({ id: 'shop_1', trialConsumedAt: new Date() });

    const result = await resolveTrial(user, buildPlan());

    expect(result.eligibleForTrial).toBe(false);
    expect(result.trialDays).toBe(0);
    expect(result.trialEndsAt).toBeNull();
  });
});
