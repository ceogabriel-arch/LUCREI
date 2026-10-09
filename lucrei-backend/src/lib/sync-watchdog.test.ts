import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    shop: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('./prisma', () => ({ prisma: prismaMock }));

import { isSyncStuck, resetStuckSyncs, STUCK_SYNC_MINUTES, STUCK_BACKFILL_MINUTES } from './sync-watchdog';

const NOW = new Date('2026-10-09T12:00:00Z').getTime();

describe('isSyncStuck', () => {
  it('is false for a shop with nothing running', () => {
    const shop = { syncStatus: 'done', syncStartedAt: null, historyBackfillStatus: 'done', historyBackfillStartedAt: null };
    expect(isSyncStuck(shop, NOW)).toEqual({ sync: false, backfill: false });
  });

  it('is false for a sync still within the normal time window', () => {
    const shop = {
      syncStatus: 'running',
      syncStartedAt: new Date(NOW - 2 * 60_000),
      historyBackfillStatus: null,
      historyBackfillStartedAt: null,
    };
    expect(isSyncStuck(shop, NOW)).toEqual({ sync: false, backfill: false });
  });

  it('is true for a sync running past STUCK_SYNC_MINUTES', () => {
    const shop = {
      syncStatus: 'running',
      syncStartedAt: new Date(NOW - (STUCK_SYNC_MINUTES + 1) * 60_000),
      historyBackfillStatus: null,
      historyBackfillStartedAt: null,
    };
    expect(isSyncStuck(shop, NOW)).toEqual({ sync: true, backfill: false });
  });

  it('is true for a backfill running past STUCK_BACKFILL_MINUTES, independent of sync', () => {
    const shop = {
      syncStatus: 'done',
      syncStartedAt: new Date(NOW - 60_000),
      historyBackfillStatus: 'running',
      historyBackfillStartedAt: new Date(NOW - (STUCK_BACKFILL_MINUTES + 1) * 60_000),
    };
    expect(isSyncStuck(shop, NOW)).toEqual({ sync: false, backfill: true });
  });

  it('is false for "running" with no syncStartedAt (shouldn\'t happen, but don\'t crash/flag it)', () => {
    const shop = { syncStatus: 'running', syncStartedAt: null, historyBackfillStatus: null, historyBackfillStartedAt: null };
    expect(isSyncStuck(shop, NOW)).toEqual({ sync: false, backfill: false });
  });
});

describe('resetStuckSyncs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets a shop stuck in sync and leaves a clear error message', async () => {
    prismaMock.shop.findMany.mockResolvedValue([
      {
        id: 'shop1',
        shopName: 'Rubia Fantasias',
        syncStatus: 'running',
        syncStartedAt: new Date(NOW - (STUCK_SYNC_MINUTES + 10) * 60_000),
        historyBackfillStatus: null,
        historyBackfillStartedAt: null,
      },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const recovered = await resetStuckSyncs();

    expect(recovered).toBe(1);
    expect(prismaMock.shop.update).toHaveBeenCalledWith({
      where: { id: 'shop1' },
      data: expect.objectContaining({ syncStatus: 'error', syncError: expect.stringContaining('watchdog') }),
    });
    vi.useRealTimers();
  });

  it('does not touch a shop still inside the normal sync window', async () => {
    prismaMock.shop.findMany.mockResolvedValue([
      { id: 'shop1', shopName: 'X', syncStatus: 'running', syncStartedAt: new Date(NOW - 60_000), historyBackfillStatus: null, historyBackfillStartedAt: null },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    const recovered = await resetStuckSyncs();

    expect(recovered).toBe(0);
    expect(prismaMock.shop.update).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('resets sync and backfill independently on the same shop', async () => {
    prismaMock.shop.findMany.mockResolvedValue([
      {
        id: 'shop1',
        shopName: 'X',
        syncStatus: 'running',
        syncStartedAt: new Date(NOW - (STUCK_SYNC_MINUTES + 1) * 60_000),
        historyBackfillStatus: 'running',
        historyBackfillStartedAt: new Date(NOW - (STUCK_BACKFILL_MINUTES + 1) * 60_000),
      },
    ]);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);

    await resetStuckSyncs();

    expect(prismaMock.shop.update).toHaveBeenCalledWith({
      where: { id: 'shop1' },
      data: expect.objectContaining({
        syncStatus: 'error',
        syncError: expect.any(String),
        historyBackfillStatus: 'error',
        historyBackfillError: expect.any(String),
      }),
    });
    vi.useRealTimers();
  });
});
