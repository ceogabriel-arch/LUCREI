import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, runShopSyncMock, runMLShopSyncMock } = vi.hoisted(() => ({
  prismaMock: {
    shop: { findMany: vi.fn() },
  },
  runShopSyncMock: vi.fn(),
  runMLShopSyncMock: vi.fn(),
}));

vi.mock('./prisma', () => ({ prisma: prismaMock }));
vi.mock('../modules/sync/service', () => ({ runShopSync: runShopSyncMock }));
vi.mock('../modules/sync/mercadolivre-service', () => ({ runShopSync: runMLShopSyncMock }));

import { isShopSyncStale, STALE_SYNC_HOURS, syncStaleShops } from './shop-sync-watchdog';

const NOW = new Date('2026-10-19T12:00:00Z').getTime();
const HOUR_MS = 60 * 60 * 1000;

describe('isShopSyncStale', () => {
  it('is false for a disconnected shop', () => {
    expect(isShopSyncStale({ status: 'disconnected', syncStatus: 'done', lastSyncedAt: null }, NOW)).toBe(false);
  });

  it('is false for a sync currently running', () => {
    expect(isShopSyncStale({ status: 'active', syncStatus: 'running', lastSyncedAt: new Date(NOW - 10 * HOUR_MS) }, NOW)).toBe(false);
  });

  it('is true for a shop that never synced', () => {
    expect(isShopSyncStale({ status: 'active', syncStatus: 'done', lastSyncedAt: null }, NOW)).toBe(true);
  });

  it('is false while still inside STALE_SYNC_HOURS', () => {
    const shop = { status: 'active', syncStatus: 'done', lastSyncedAt: new Date(NOW - (STALE_SYNC_HOURS - 1) * HOUR_MS) };
    expect(isShopSyncStale(shop, NOW)).toBe(false);
  });

  it('is true once past STALE_SYNC_HOURS', () => {
    const shop = { status: 'active', syncStatus: 'done', lastSyncedAt: new Date(NOW - (STALE_SYNC_HOURS + 1) * HOUR_MS) };
    expect(isShopSyncStale(shop, NOW)).toBe(true);
  });

  it('is true for a shop stuck in error past STALE_SYNC_HOURS', () => {
    const shop = { status: 'active', syncStatus: 'error', lastSyncedAt: new Date(NOW - (STALE_SYNC_HOURS + 1) * HOUR_MS) };
    expect(isShopSyncStale(shop, NOW)).toBe(true);
  });
});

describe('syncStaleShops', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('syncs a stale Shopee shop through the normal Shopee sync path', async () => {
    prismaMock.shop.findMany.mockResolvedValue([
      { id: 'shop1', shopName: 'Rubia Fantasias', provider: 'shopee', status: 'active', syncStatus: 'done', lastSyncedAt: new Date(NOW - (STALE_SYNC_HOURS + 1) * HOUR_MS) },
    ]);
    runShopSyncMock.mockResolvedValue(undefined);

    const synced = await syncStaleShops();

    expect(synced).toBe(1);
    expect(runShopSyncMock).toHaveBeenCalledWith('shop1');
    expect(runMLShopSyncMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('syncs a stale Mercado Livre shop through the ML sync path', async () => {
    prismaMock.shop.findMany.mockResolvedValue([
      { id: 'shop1', shopName: 'X', provider: 'mercado_livre', status: 'active', syncStatus: 'done', lastSyncedAt: new Date(NOW - (STALE_SYNC_HOURS + 1) * HOUR_MS) },
    ]);
    runMLShopSyncMock.mockResolvedValue(undefined);

    const synced = await syncStaleShops();

    expect(synced).toBe(1);
    expect(runMLShopSyncMock).toHaveBeenCalledWith('shop1');
    expect(runShopSyncMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not touch a shop still inside the fresh window', async () => {
    prismaMock.shop.findMany.mockResolvedValue([
      { id: 'shop1', shopName: 'X', provider: 'shopee', status: 'active', syncStatus: 'done', lastSyncedAt: new Date(NOW - 60_000) },
    ]);

    const synced = await syncStaleShops();

    expect(synced).toBe(0);
    expect(runShopSyncMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('keeps syncing the other shops when one fails', async () => {
    prismaMock.shop.findMany.mockResolvedValue([
      { id: 'shop1', shopName: 'A', provider: 'shopee', status: 'active', syncStatus: 'done', lastSyncedAt: new Date(NOW - (STALE_SYNC_HOURS + 1) * HOUR_MS) },
      { id: 'shop2', shopName: 'B', provider: 'shopee', status: 'active', syncStatus: 'done', lastSyncedAt: new Date(NOW - (STALE_SYNC_HOURS + 1) * HOUR_MS) },
    ]);
    runShopSyncMock.mockRejectedValueOnce(new Error('falhou')).mockResolvedValueOnce(undefined);

    const synced = await syncStaleShops();

    expect(synced).toBe(2);
    expect(runShopSyncMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
