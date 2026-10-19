import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn(), update: vi.fn() },
    subscription: { findFirst: vi.fn() },
  },
}));

vi.mock('./prisma', () => ({ prisma: prismaMock }));

import { expireCanceledSubscriptions, isCanceledSubscriptionExpired } from './canceled-subscription-expiry-watchdog';

const NOW = new Date('2026-10-19T12:00:00Z').getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

describe('isCanceledSubscriptionExpired', () => {
  it('is false for a non-canceled user', () => {
    const sub = { currentPeriodEnd: new Date(NOW - DAY_MS), createdAt: new Date(NOW - 30 * DAY_MS) };
    expect(isCanceledSubscriptionExpired({ subscriptionStatus: 'active' }, sub, NOW)).toBe(false);
  });

  it('is false while the paid period is still running', () => {
    const sub = { currentPeriodEnd: new Date(NOW + DAY_MS), createdAt: new Date(NOW - 30 * DAY_MS) };
    expect(isCanceledSubscriptionExpired({ subscriptionStatus: 'canceled' }, sub, NOW)).toBe(false);
  });

  it('is true once the paid period has ended', () => {
    const sub = { currentPeriodEnd: new Date(NOW - DAY_MS), createdAt: new Date(NOW - 30 * DAY_MS) };
    expect(isCanceledSubscriptionExpired({ subscriptionStatus: 'canceled' }, sub, NOW)).toBe(true);
  });

  it('falls back to createdAt when currentPeriodEnd is null (e.g. canceled before ever paying)', () => {
    const sub = { currentPeriodEnd: null, createdAt: new Date(NOW - DAY_MS) };
    expect(isCanceledSubscriptionExpired({ subscriptionStatus: 'canceled' }, sub, NOW)).toBe(true);
  });

  it('is false when there is no subscription at all', () => {
    expect(isCanceledSubscriptionExpired({ subscriptionStatus: 'canceled' }, null, NOW)).toBe(false);
  });
});

describe('expireCanceledSubscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('marks an expired canceled subscription as past_due, without touching Subscription.status', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'user1', subscriptionStatus: 'canceled' }]);
    prismaMock.subscription.findFirst.mockResolvedValue({
      currentPeriodEnd: new Date(NOW - DAY_MS),
      createdAt: new Date(NOW - 30 * DAY_MS),
    });

    const expired = await expireCanceledSubscriptions();

    expect(expired).toBe(1);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { subscriptionStatus: 'past_due' },
    });
    vi.useRealTimers();
  });

  it('does nothing when the canceled period is still running', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'user1', subscriptionStatus: 'canceled' }]);
    prismaMock.subscription.findFirst.mockResolvedValue({
      currentPeriodEnd: new Date(NOW + DAY_MS),
      createdAt: new Date(NOW - 30 * DAY_MS),
    });

    const expired = await expireCanceledSubscriptions();

    expect(expired).toBe(0);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does nothing when there are no canceled users', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);

    const expired = await expireCanceledSubscriptions();

    expect(expired).toBe(0);
    expect(prismaMock.subscription.findFirst).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
