import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, deactivatePaymentLinkMock, getSubscriptionByPaymentLinkIdMock } = vi.hoisted(() => ({
  prismaMock: {
    subscription: { findMany: vi.fn(), update: vi.fn() },
  },
  deactivatePaymentLinkMock: vi.fn(),
  getSubscriptionByPaymentLinkIdMock: vi.fn(),
}));

vi.mock('./prisma', () => ({ prisma: prismaMock }));
vi.mock('../hypercash-client', () => ({
  deactivatePaymentLink: deactivatePaymentLinkMock,
  getSubscriptionByPaymentLinkId: getSubscriptionByPaymentLinkIdMock,
}));

import { expireStaleCheckouts, isCheckoutStale, PENDING_CHECKOUT_EXPIRY_HOURS } from './hypercash-expiry-watchdog';

const NOW = new Date('2026-10-15T12:00:00Z').getTime();
const HOUR_MS = 60 * 60 * 1000;

describe('isCheckoutStale', () => {
  it('is false for a subscription with no pending link', () => {
    expect(isCheckoutStale({ provider: 'hypercash', status: 'past_due', providerSubscriptionId: null, updatedAt: new Date(NOW) }, NOW)).toBe(false);
  });

  it('is false while still inside the expiry window', () => {
    const sub = { provider: 'hypercash', status: 'past_due', providerSubscriptionId: 'link1', updatedAt: new Date(NOW - 2 * HOUR_MS) };
    expect(isCheckoutStale(sub, NOW)).toBe(false);
  });

  it('is true once past PENDING_CHECKOUT_EXPIRY_HOURS', () => {
    const sub = {
      provider: 'hypercash',
      status: 'past_due',
      providerSubscriptionId: 'link1',
      updatedAt: new Date(NOW - (PENDING_CHECKOUT_EXPIRY_HOURS + 1) * HOUR_MS),
    };
    expect(isCheckoutStale(sub, NOW)).toBe(true);
  });

  it('is false for a trialing subscription even with an old pending link (pay-early case)', () => {
    const sub = {
      provider: 'hypercash',
      status: 'trialing',
      providerSubscriptionId: 'link1',
      updatedAt: new Date(NOW - (PENDING_CHECKOUT_EXPIRY_HOURS + 10) * HOUR_MS),
    };
    expect(isCheckoutStale(sub, NOW)).toBe(false);
  });

  it('is false when the checkout was already expired (lastInvoiceUrl cleared)', () => {
    const sub = {
      provider: 'hypercash',
      status: 'past_due',
      providerSubscriptionId: 'link1',
      lastInvoiceUrl: null,
      updatedAt: new Date(NOW - (PENDING_CHECKOUT_EXPIRY_HOURS + 1) * HOUR_MS),
    };
    expect(isCheckoutStale(sub, NOW)).toBe(false);
  });

  it('is false for a non-hypercash provider', () => {
    const sub = {
      provider: 'mercado_pago',
      status: 'past_due',
      providerSubscriptionId: 'link1',
      updatedAt: new Date(NOW - (PENDING_CHECKOUT_EXPIRY_HOURS + 1) * HOUR_MS),
    };
    expect(isCheckoutStale(sub, NOW)).toBe(false);
  });
});

describe('expireStaleCheckouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  it('deactivates a never-paid link on HyperCash and clears only the checkout URL (keeps the link id traceable)', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      {
        id: 'sub1',
        provider: 'hypercash',
        status: 'past_due',
        providerSubscriptionId: 'link1',
        updatedAt: new Date(NOW - (PENDING_CHECKOUT_EXPIRY_HOURS + 1) * HOUR_MS),
      },
    ]);
    getSubscriptionByPaymentLinkIdMock.mockResolvedValue(null);
    deactivatePaymentLinkMock.mockResolvedValue({});

    const expired = await expireStaleCheckouts();

    expect(expired).toBe(1);
    expect(deactivatePaymentLinkMock).toHaveBeenCalledWith('link1');
    expect(prismaMock.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub1' },
      data: { lastInvoiceUrl: null },
    });
    vi.useRealTimers();
  });

  it('never expires a link that already has a real (paid) HyperCash subscription - failed renewal, not abandoned checkout', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      {
        id: 'sub1',
        provider: 'hypercash',
        status: 'past_due',
        providerSubscriptionId: 'link1',
        lastInvoiceUrl: 'https://pay/link1',
        updatedAt: new Date(NOW - (PENDING_CHECKOUT_EXPIRY_HOURS + 1) * HOUR_MS),
      },
    ]);
    getSubscriptionByPaymentLinkIdMock.mockResolvedValue({ id: 'hc_sub_1', status: 'payment_failed' });

    const expired = await expireStaleCheckouts();

    expect(expired).toBe(0);
    expect(deactivatePaymentLinkMock).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not expire when HyperCash cannot confirm the link was never paid', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      {
        id: 'sub1',
        provider: 'hypercash',
        status: 'past_due',
        providerSubscriptionId: 'link1',
        updatedAt: new Date(NOW - (PENDING_CHECKOUT_EXPIRY_HOURS + 1) * HOUR_MS),
      },
    ]);
    getSubscriptionByPaymentLinkIdMock.mockRejectedValue(new Error('timeout'));

    const expired = await expireStaleCheckouts();

    expect(expired).toBe(0);
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('still clears the local reference even when deactivating on HyperCash fails', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([
      {
        id: 'sub1',
        provider: 'hypercash',
        status: 'past_due',
        providerSubscriptionId: 'link1',
        updatedAt: new Date(NOW - (PENDING_CHECKOUT_EXPIRY_HOURS + 1) * HOUR_MS),
      },
    ]);
    getSubscriptionByPaymentLinkIdMock.mockResolvedValue(null);
    deactivatePaymentLinkMock.mockRejectedValue(new Error('erro da HyperCash'));

    const expired = await expireStaleCheckouts();

    expect(expired).toBe(1);
    expect(prismaMock.subscription.update).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does nothing when there are no stale checkouts', async () => {
    prismaMock.subscription.findMany.mockResolvedValue([]);

    const expired = await expireStaleCheckouts();

    expect(expired).toBe(0);
    expect(deactivatePaymentLinkMock).not.toHaveBeenCalled();
    expect(prismaMock.subscription.update).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
