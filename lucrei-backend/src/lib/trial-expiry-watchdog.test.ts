import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    user: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('./prisma', () => ({ prisma: prismaMock }));

import { expireStaleTrials, isTrialExpired } from './trial-expiry-watchdog';

const NOW = new Date('2026-10-16T12:00:00Z').getTime();
const HOUR_MS = 60 * 60 * 1000;

describe('isTrialExpired', () => {
  it('is false for a non-trialing user', () => {
    expect(isTrialExpired({ subscriptionStatus: 'past_due', trialEndsAt: new Date(NOW - HOUR_MS) }, NOW)).toBe(false);
  });

  it('is false while the trial is still running', () => {
    expect(isTrialExpired({ subscriptionStatus: 'trialing', trialEndsAt: new Date(NOW + HOUR_MS) }, NOW)).toBe(false);
  });

  it('is false for a trialing user with no trialEndsAt', () => {
    expect(isTrialExpired({ subscriptionStatus: 'trialing', trialEndsAt: null }, NOW)).toBe(false);
  });

  it('is true once trialEndsAt has passed', () => {
    expect(isTrialExpired({ subscriptionStatus: 'trialing', trialEndsAt: new Date(NOW - HOUR_MS) }, NOW)).toBe(true);
  });
});

describe('expireStaleTrials', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('marks an expired trial as past_due', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'user1', subscriptionStatus: 'trialing', trialEndsAt: new Date(NOW - HOUR_MS) },
    ]);

    const expired = await expireStaleTrials();

    expect(expired).toBe(1);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { subscriptionStatus: 'past_due' },
    });
    vi.useRealTimers();
  });

  it('does nothing when there are no expired trials', async () => {
    prismaMock.user.findMany.mockResolvedValue([]);

    const expired = await expireStaleTrials();

    expect(expired).toBe(0);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
