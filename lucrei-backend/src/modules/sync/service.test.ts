import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, getOrderDetailMock, getEscrowDetailMock } = vi.hoisted(() => ({
  prismaMock: {
    shop: { findUnique: vi.fn() },
    order: { deleteMany: vi.fn(), upsert: vi.fn() },
  },
  getOrderDetailMock: vi.fn(),
  getEscrowDetailMock: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('../../lib/shopee-token', () => ({
  getValidAccessToken: vi.fn().mockResolvedValue({ accessToken: 'tok', shopeeShopId: 1 }),
}));
vi.mock('../../shopee-client', () => ({
  getOrderDetail: getOrderDetailMock,
  getEscrowDetail: getEscrowDetailMock,
  getOrderList: vi.fn(),
}));
vi.mock('../../lib/daily-goal-notifications', () => ({ checkDailyGoalReached: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../lib/order-notifications', () => ({ notifyOrderCompletedIfNeeded: vi.fn().mockResolvedValue(undefined) }));

import { syncOneOrder } from './service';

describe('syncOneOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shop.findUnique.mockResolvedValue({ taxRatePercent: null });
  });

  it('deletes instead of recreating when the push status is stale and the order is already cancelled', async () => {
    getOrderDetailMock.mockResolvedValue([{ order_sn: 'SN1', order_status: 'CANCELLED', create_time: 1, update_time: 2 }]);

    const result = await syncOneOrder('shop1', 'SN1', 'READY_TO_SHIP');

    expect(result).toBeNull();
    expect(prismaMock.order.deleteMany).toHaveBeenCalledWith({ where: { shopId: 'shop1', shopeeOrderSn: 'SN1' } });
    expect(getEscrowDetailMock).not.toHaveBeenCalled();
    expect(prismaMock.order.upsert).not.toHaveBeenCalled();
  });

  it('skips orders that are not a sale yet according to the detail', async () => {
    getOrderDetailMock.mockResolvedValue([{ order_sn: 'SN1', order_status: 'UNPAID', create_time: 1, update_time: 2 }]);

    const result = await syncOneOrder('shop1', 'SN1', 'READY_TO_SHIP');

    expect(result).toBeNull();
    expect(getEscrowDetailMock).not.toHaveBeenCalled();
    expect(prismaMock.order.deleteMany).not.toHaveBeenCalled();
  });
});
