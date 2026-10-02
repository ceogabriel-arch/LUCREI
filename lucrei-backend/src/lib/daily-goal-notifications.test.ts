import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, sendPushNotificationMock, computeShopSummaryMock } = vi.hoisted(() => ({
  prismaMock: {
    shop: { findUnique: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), updateMany: vi.fn() },
    subscription: { findFirst: vi.fn() },
    order: { count: vi.fn() },
  },
  sendPushNotificationMock: vi.fn(),
  computeShopSummaryMock: vi.fn(),
}));

vi.mock('./prisma', () => ({ prisma: prismaMock }));
vi.mock('./push-notifications', () => ({
  sendPushNotification: sendPushNotificationMock,
  formatBRL: (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`,
}));
vi.mock('../modules/summary/routes', () => ({ computeShopSummary: computeShopSummaryMock }));

import { checkDailyGoalReached } from './daily-goal-notifications';

const BASE_SHOP = { id: 's1', userId: 'u1', status: 'active' };
const BASE_USER = { id: 'u1', pushToken: 'ExponentPushToken[abc]', dailyProfitGoal: 100, dailyGoalNotifiedAt: null };

describe('checkDailyGoalReached', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.shop.findUnique.mockResolvedValue(BASE_SHOP);
    prismaMock.shop.findMany.mockResolvedValue([BASE_SHOP]);
    prismaMock.order.count.mockResolvedValue(0);
  });

  it('does nothing when the user has no daily goal configured', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...BASE_USER, dailyProfitGoal: null });
    await checkDailyGoalReached('s1');
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('does nothing when the user has no push token', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...BASE_USER, pushToken: null });
    await checkDailyGoalReached('s1');
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('does nothing when already notified today', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ ...BASE_USER, dailyGoalNotifiedAt: new Date() });
    await checkDailyGoalReached('s1');
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
    expect(computeShopSummaryMock).not.toHaveBeenCalled();
  });

  it("notifies again the next day (dailyGoalNotifiedAt from yesterday doesn't block)", async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    prismaMock.user.findUnique.mockResolvedValue({ ...BASE_USER, dailyGoalNotifiedAt: yesterday });
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    computeShopSummaryMock.mockResolvedValue({ profit: 150 });

    await checkDailyGoalReached('s1');
    expect(sendPushNotificationMock).toHaveBeenCalledTimes(1);
  });

  it("does not notify when today's profit is below the goal", async () => {
    prismaMock.user.findUnique.mockResolvedValue(BASE_USER);
    computeShopSummaryMock.mockResolvedValue({ profit: 50 });

    await checkDailyGoalReached('s1');
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('sends the "Meta batida" push with the profit sound when the goal is reached, summing all active shops', async () => {
    prismaMock.user.findUnique.mockResolvedValue(BASE_USER);
    prismaMock.shop.findMany.mockResolvedValue([BASE_SHOP, { id: 's2', userId: 'u1', status: 'active' }]);
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    computeShopSummaryMock.mockResolvedValueOnce({ profit: 60 }).mockResolvedValueOnce({ profit: 45 });

    await checkDailyGoalReached('s1');

    expect(sendPushNotificationMock).toHaveBeenCalledWith(
      'ExponentPushToken[abc]',
      'Meta batida!',
      expect.stringContaining('105,00'),
      {},
      'lu-crei.wav'
    );
  });

  it('skips sending when a concurrent call already claimed the notification (updateMany matches 0 rows)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(BASE_USER);
    prismaMock.user.updateMany.mockResolvedValue({ count: 0 });
    computeShopSummaryMock.mockResolvedValue({ profit: 150 });

    await checkDailyGoalReached('s1');
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('rolls back dailyGoalNotifiedAt when the send itself fails', async () => {
    prismaMock.user.findUnique.mockResolvedValue(BASE_USER);
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
    computeShopSummaryMock.mockResolvedValue({ profit: 150 });
    sendPushNotificationMock.mockRejectedValue(new Error('Expo indisponível'));

    await expect(checkDailyGoalReached('s1')).rejects.toThrow('Expo indisponível');
    expect(prismaMock.user.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.user.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'u1', dailyGoalNotifiedAt: { not: null } },
      data: { dailyGoalNotifiedAt: null },
    });
  });

  it('does not send when the shop no longer exists', async () => {
    prismaMock.shop.findUnique.mockResolvedValue(null);
    await checkDailyGoalReached('s1');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });
});
