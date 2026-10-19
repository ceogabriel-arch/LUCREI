import { describe, expect, it, vi, beforeEach } from 'vitest';

const { prismaMock, createOneTimePaymentLinkMock } = vi.hoisted(() => ({
  prismaMock: {
    subscription: { findFirst: vi.fn() },
    hypercashUpgradeCharge: { create: vi.fn() },
  },
  createOneTimePaymentLinkMock: vi.fn(),
}));

vi.mock('./prisma', () => ({ prisma: prismaMock }));
vi.mock('../hypercash-client', () => ({
  createOneTimePaymentLink: createOneTimePaymentLinkMock,
  priceToCents: (amount: number) => Math.round(amount * 100),
}));

import { createProratedUpgradeCharge } from './plan-upgrade';

const NOW = new Date('2026-10-19T12:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

function makePlan(overrides: Partial<{ id: string; priceCurrent: number | null; billingPeriod: 'monthly' | 'annual' }> = {}) {
  return {
    id: 'plan_start',
    key: 'start',
    name: 'Start',
    billingPeriod: 'monthly' as const,
    priceCurrent: 97,
    ...overrides,
  } as any;
}

function makeUser(plan: any) {
  return { id: 'user1', plan } as any;
}

describe('createProratedUpgradeCharge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('returns null when the user has no current plan', async () => {
    const result = await createProratedUpgradeCharge(makeUser(null), makePlan({ id: 'plan_pro' }));
    expect(result).toBeNull();
  });

  it('returns null when picking the same plan', async () => {
    const plan = makePlan();
    const result = await createProratedUpgradeCharge(makeUser(plan), plan);
    expect(result).toBeNull();
  });

  it('returns null when the billing period differs (monthly -> annual)', async () => {
    const result = await createProratedUpgradeCharge(
      makeUser(makePlan({ billingPeriod: 'monthly' })),
      makePlan({ id: 'plan_pro', billingPeriod: 'annual', priceCurrent: 970 })
    );
    expect(result).toBeNull();
  });

  it('returns null for a downgrade (cheaper plan)', async () => {
    const result = await createProratedUpgradeCharge(
      makeUser(makePlan({ priceCurrent: 197 })),
      makePlan({ id: 'plan_start', priceCurrent: 97 })
    );
    expect(result).toBeNull();
  });

  it('returns null when there is no paid subscription on file', async () => {
    prismaMock.subscription.findFirst.mockResolvedValue(null);
    const result = await createProratedUpgradeCharge(makeUser(makePlan()), makePlan({ id: 'plan_pro', priceCurrent: 197 }));
    expect(result).toBeNull();
  });

  it('returns null when the paid cycle already ended', async () => {
    prismaMock.subscription.findFirst.mockResolvedValue({
      id: 'sub1',
      currentPeriodEnd: new Date(NOW - DAY_MS),
      pendingCouponPercentOff: null,
    });
    const result = await createProratedUpgradeCharge(makeUser(makePlan()), makePlan({ id: 'plan_pro', priceCurrent: 197 }));
    expect(result).toBeNull();
  });

  it('charges the prorated difference for the remaining cycle, no coupon', async () => {
    // 15 dias restantes de 30 (meio do ciclo) - metade da diferença de preço.
    prismaMock.subscription.findFirst.mockResolvedValue({
      id: 'sub1',
      currentPeriodEnd: new Date(NOW + 15 * DAY_MS),
      pendingCouponPercentOff: null,
    });
    createOneTimePaymentLinkMock.mockResolvedValue({ id: 'link1', checkoutUrl: 'https://pay.hypercash.com.br/x' });

    const result = await createProratedUpgradeCharge(
      makeUser(makePlan({ priceCurrent: 97 })),
      makePlan({ id: 'plan_pro', priceCurrent: 197 })
    );

    expect(result).toEqual({ checkoutUrl: 'https://pay.hypercash.com.br/x' });
    // priceDiff 100 * 0.5 = 50
    expect(createOneTimePaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 5000 }));
    expect(prismaMock.hypercashUpgradeCharge.create).toHaveBeenCalledWith({
      data: { subscriptionId: 'sub1', targetPlanId: 'plan_pro', paymentLinkId: 'link1', amount: 50 },
    });
    vi.useRealTimers();
  });

  it('applies the account-wide coupon discount to the prorated amount', async () => {
    prismaMock.subscription.findFirst.mockResolvedValue({
      id: 'sub1',
      currentPeriodEnd: new Date(NOW + 15 * DAY_MS),
      pendingCouponPercentOff: 20,
    });
    createOneTimePaymentLinkMock.mockResolvedValue({ id: 'link1', checkoutUrl: 'https://pay.hypercash.com.br/x' });

    await createProratedUpgradeCharge(makeUser(makePlan({ priceCurrent: 97 })), makePlan({ id: 'plan_pro', priceCurrent: 197 }));

    // 50 proporcional * 0.8 (20% off) = 40
    expect(createOneTimePaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 4000 }));
    expect(prismaMock.hypercashUpgradeCharge.create).toHaveBeenCalledWith({
      data: { subscriptionId: 'sub1', targetPlanId: 'plan_pro', paymentLinkId: 'link1', amount: 40 },
    });
    vi.useRealTimers();
  });

  it('caps the remaining fraction at 1 when currentPeriodEnd is further than a full cycle away', async () => {
    prismaMock.subscription.findFirst.mockResolvedValue({
      id: 'sub1',
      currentPeriodEnd: new Date(NOW + 60 * DAY_MS),
      pendingCouponPercentOff: null,
    });
    createOneTimePaymentLinkMock.mockResolvedValue({ id: 'link1', checkoutUrl: 'https://pay.hypercash.com.br/x' });

    await createProratedUpgradeCharge(makeUser(makePlan({ priceCurrent: 97 })), makePlan({ id: 'plan_pro', priceCurrent: 197 }));

    // fraction = min(1, 60/30) = 1 -> cobra a diferença cheia (100)
    expect(createOneTimePaymentLinkMock).toHaveBeenCalledWith(expect.objectContaining({ priceCents: 10000 }));
    vi.useRealTimers();
  });
});
