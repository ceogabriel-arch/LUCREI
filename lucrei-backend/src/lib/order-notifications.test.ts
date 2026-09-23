import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock é hoisted pro topo do arquivo pelo Vitest - precisa dos mocks
// vindo de vi.hoisted() pra existirem antes disso rodar, senão dá erro de
// "cannot access before initialization".
const { prismaMock, sendPushNotificationMock } = vi.hoisted(() => ({
  prismaMock: {
    order: { updateMany: vi.fn() },
    shop: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  sendPushNotificationMock: vi.fn(),
}));

vi.mock('./prisma', () => ({ prisma: prismaMock }));
vi.mock('./push-notifications', () => ({
  sendPushNotification: sendPushNotificationMock,
  formatBRL: (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`,
}));

// vi.mock acima é hoisted pro topo do módulo pelo Vitest, então esse import
// estático já enxerga as versões mockadas - não precisa de import()
// dinâmico (que quebra o tsc --noEmit num projeto CommonJS).
import { notifyOrderCompletedIfNeeded } from './order-notifications';

describe('notifyOrderCompletedIfNeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when completedAt is null (pedido sem data de conclusão)', async () => {
    await notifyOrderCompletedIfNeeded({
      orderId: 'o1',
      orderSn: 'SN1',
      shopDbId: 's1',
      completedAt: null,
      totalProfit: 10,
    });
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('does nothing when the order completed more than 24h ago (evita notificar pedido velho num backfill)', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await notifyOrderCompletedIfNeeded({
      orderId: 'o1',
      orderSn: 'SN1',
      shopDbId: 's1',
      completedAt: old,
      totalProfit: 10,
    });
    expect(prismaMock.order.updateMany).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('skips sending when the order was already notified (updateMany não bate nenhuma linha)', async () => {
    prismaMock.order.updateMany.mockResolvedValue({ count: 0 });
    await notifyOrderCompletedIfNeeded({
      orderId: 'o1',
      orderSn: 'SN1',
      shopDbId: 's1',
      completedAt: new Date(),
      totalProfit: 10,
    });
    expect(prismaMock.shop.findUnique).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('sends the profit message once it claims the order and the owner has a push token', async () => {
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.shop.findUnique.mockResolvedValue({ id: 's1', userId: 'u1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', pushToken: 'ExponentPushToken[abc]' });

    await notifyOrderCompletedIfNeeded({
      orderId: 'o1',
      orderSn: 'SN123',
      shopDbId: 's1',
      completedAt: new Date(),
      totalProfit: 42.5,
    });

    expect(sendPushNotificationMock).toHaveBeenCalledWith(
      'ExponentPushToken[abc]',
      'Novo pedido concluído! 🎉',
      expect.stringContaining('42,50'),
      { orderSn: 'SN123' }
    );
  });

  it('sends the "cadastre o custo" message when totalProfit is null', async () => {
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.shop.findUnique.mockResolvedValue({ id: 's1', userId: 'u1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', pushToken: 'ExponentPushToken[abc]' });

    await notifyOrderCompletedIfNeeded({
      orderId: 'o1',
      orderSn: 'SN123',
      shopDbId: 's1',
      completedAt: new Date(),
      totalProfit: null,
    });

    expect(sendPushNotificationMock).toHaveBeenCalledWith(
      'ExponentPushToken[abc]',
      'Novo pedido concluído! 🎉',
      expect.stringContaining('Cadastre o custo'),
      { orderSn: 'SN123' }
    );
  });

  it('does not send when the owner has no push token registered', async () => {
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.shop.findUnique.mockResolvedValue({ id: 's1', userId: 'u1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', pushToken: null });

    await notifyOrderCompletedIfNeeded({
      orderId: 'o1',
      orderSn: 'SN1',
      shopDbId: 's1',
      completedAt: new Date(),
      totalProfit: 10,
    });

    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('does not send when the shop no longer exists', async () => {
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.shop.findUnique.mockResolvedValue(null);

    await notifyOrderCompletedIfNeeded({
      orderId: 'o1',
      orderSn: 'SN1',
      shopDbId: 's1',
      completedAt: new Date(),
      totalProfit: 10,
    });

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(sendPushNotificationMock).not.toHaveBeenCalled();
  });

  it('rolls back notifiedAt when the send itself fails, so a future sync retries it', async () => {
    prismaMock.order.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.shop.findUnique.mockResolvedValue({ id: 's1', userId: 'u1' });
    prismaMock.user.findUnique.mockResolvedValue({ id: 'u1', pushToken: 'ExponentPushToken[abc]' });
    sendPushNotificationMock.mockRejectedValue(new Error('Expo API indisponível'));

    await expect(
      notifyOrderCompletedIfNeeded({
        orderId: 'o1',
        orderSn: 'SN1',
        shopDbId: 's1',
        completedAt: new Date(),
        totalProfit: 10,
      })
    ).rejects.toThrow('Expo API indisponível');

    // 1ª chamada reserva o pedido (notifiedAt: null -> agora), 2ª chamada
    // reverte depois do envio falhar (notifiedAt: not null -> null de novo).
    expect(prismaMock.order.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.order.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: 'o1', notifiedAt: { not: null } },
      data: { notifiedAt: null },
    });
  });
});
