import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { recentOrderEvent: { upsert: vi.fn() } },
}));

vi.mock('./prisma', () => ({ prisma: prismaMock }));

import { trackRecentMercadoLivreOrderEvent, trackRecentOrderEvent } from './recent-order-events';

describe('trackRecentOrderEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts by shopeeOrderSn, só define orderDate na criação', async () => {
    await trackRecentOrderEvent('shop1', 'SN123', 'READY_TO_SHIP');

    expect(prismaMock.recentOrderEvent.upsert).toHaveBeenCalledTimes(1);
    const call = prismaMock.recentOrderEvent.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ shopeeOrderSn: 'SN123' });
    expect(call.update).toEqual({ orderStatus: 'READY_TO_SHIP' });
    expect(call.create).toMatchObject({ shopId: 'shop1', shopeeOrderSn: 'SN123', orderStatus: 'READY_TO_SHIP' });
    expect(call.create.orderDate).toBeInstanceOf(Date);
  });
});

describe('trackRecentMercadoLivreOrderEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('upserts by mercadoLivreOrderId, só define orderDate na criação', async () => {
    await trackRecentMercadoLivreOrderEvent('shop1', '2000018749860592', 'confirmed');

    expect(prismaMock.recentOrderEvent.upsert).toHaveBeenCalledTimes(1);
    const call = prismaMock.recentOrderEvent.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ mercadoLivreOrderId: '2000018749860592' });
    expect(call.update).toEqual({ orderStatus: 'confirmed' });
    expect(call.create).toMatchObject({ shopId: 'shop1', mercadoLivreOrderId: '2000018749860592', orderStatus: 'confirmed' });
    expect(call.create.orderDate).toBeInstanceOf(Date);
  });
});
