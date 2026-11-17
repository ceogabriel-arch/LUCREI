import { Status } from '@apple/app-store-server-library';
import { describe, expect, it } from 'vitest';

import {
  GRACE_DAYS,
  inheritedGraceSince,
  pixChargeNeedsActivationRecovery,
  planWhilePaymentPending,
  resolveAppleTransactionStatus,
  revokedAccessPeriodEnd,
  summarizeHypercashWebhook,
} from './billing-rules';

const NOW = new Date('2026-11-16T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

describe('revokedAccessPeriodEnd', () => {
  it('puts the period end exactly one grace window in the past (blocked immediately)', () => {
    expect(revokedAccessPeriodEnd(NOW.getTime()).getTime()).toBe(NOW.getTime() - GRACE_DAYS * DAY_MS);
  });
});

describe('inheritedGraceSince', () => {
  it('is null on the first subscription ever (normal grace from createdAt)', () => {
    expect(inheritedGraceSince(null, NOW)).toBeNull();
  });

  it('inherits the previous paid period end so switching plans does not restart the grace', () => {
    const periodEnd = new Date(NOW.getTime() - 5 * DAY_MS);
    expect(inheritedGraceSince({ currentPeriodEnd: periodEnd, createdAt: new Date(0) }, NOW)).toEqual(periodEnd);
  });

  it('falls back to the previous subscription createdAt when it was never paid', () => {
    const createdAt = new Date(NOW.getTime() - 3 * DAY_MS);
    expect(inheritedGraceSince({ currentPeriodEnd: null, createdAt }, NOW)).toEqual(createdAt);
  });

  it('never returns a date in the future (e.g. leaving a trial early)', () => {
    const trialEnd = new Date(NOW.getTime() + 10 * DAY_MS);
    expect(inheritedGraceSince({ currentPeriodEnd: trialEnd, createdAt: new Date(0) }, NOW)).toEqual(NOW);
  });
});

describe('planWhilePaymentPending', () => {
  type P = { id: string; priceCurrent: unknown };
  const start: P = { id: 'start', priceCurrent: 49.9 };
  // Decimal do Prisma chega como objeto/string - só precisa converter com Number().
  const pro: P = { id: 'pro', priceCurrent: '99.90' };

  it('keeps the current (cheaper) plan until an upgrade is paid', () => {
    expect(planWhilePaymentPending(start, pro)).toBe(start);
  });

  it('applies a cheaper plan right away (no gain in switching unpaid)', () => {
    expect(planWhilePaymentPending(pro, start)).toBe(start);
  });

  it('applies the chosen plan when the account has no plan yet (null would mean no limits)', () => {
    expect(planWhilePaymentPending(null, pro)).toBe(pro);
  });

  it('keeps the current plan when a price is unknown', () => {
    expect(planWhilePaymentPending(start, { id: 'enterprise', priceCurrent: null } as P)).toBe(start);
  });
});

describe('pixChargeNeedsActivationRecovery', () => {
  const charge = { periodEnd: new Date(NOW.getTime() + 30 * DAY_MS) };

  it('recovers an approved charge whose activation was never written', () => {
    expect(pixChargeNeedsActivationRecovery({ status: 'past_due', currentPeriodEnd: new Date(NOW) }, charge, false)).toBe(true);
    expect(pixChargeNeedsActivationRecovery({ status: 'past_due', currentPeriodEnd: null }, charge, false)).toBe(true);
  });

  it('is a no-op for a plain redelivery (period already written)', () => {
    expect(pixChargeNeedsActivationRecovery({ status: 'active', currentPeriodEnd: charge.periodEnd }, charge, false)).toBe(false);
  });

  it('does not reactivate a subscription that went past_due at the end of the period this charge paid', () => {
    expect(pixChargeNeedsActivationRecovery({ status: 'past_due', currentPeriodEnd: charge.periodEnd }, charge, false)).toBe(false);
  });

  it('never touches canceled subscriptions or charges superseded by a newer one', () => {
    expect(pixChargeNeedsActivationRecovery({ status: 'canceled', currentPeriodEnd: null }, charge, false)).toBe(false);
    expect(pixChargeNeedsActivationRecovery({ status: 'past_due', currentPeriodEnd: null }, charge, true)).toBe(false);
  });
});

describe('resolveAppleTransactionStatus', () => {
  const now = NOW.getTime();
  const future = now + DAY_MS;
  const past = now - DAY_MS;

  it('activates a fresh purchase with no explicit status', () => {
    expect(resolveAppleTransactionStatus({ expiresDate: future }, now)).toEqual({ kind: 'ok', status: 'active' });
  });

  it('flags a replayed purchase that already expired', () => {
    expect(resolveAppleTransactionStatus({ expiresDate: past }, now)).toEqual({ kind: 'expired' });
  });

  it('flags revoked transactions (revocationDate or REVOKED status)', () => {
    expect(resolveAppleTransactionStatus({ expiresDate: future, revocationDate: past }, now)).toEqual({ kind: 'revoked' });
    expect(resolveAppleTransactionStatus({ explicitStatus: Status.REVOKED, expiresDate: future }, now)).toEqual({ kind: 'revoked' });
  });

  it('never returns active for an ACTIVE notification whose period already ended', () => {
    expect(resolveAppleTransactionStatus({ explicitStatus: Status.ACTIVE, expiresDate: past }, now)).toEqual({ kind: 'ok', status: 'canceled' });
    expect(resolveAppleTransactionStatus({ explicitStatus: Status.ACTIVE, expiresDate: future }, now)).toEqual({ kind: 'ok', status: 'active' });
  });

  it('maps billing retry/grace to past_due and EXPIRED to canceled', () => {
    expect(resolveAppleTransactionStatus({ explicitStatus: Status.BILLING_RETRY, expiresDate: past }, now)).toEqual({ kind: 'ok', status: 'past_due' });
    expect(resolveAppleTransactionStatus({ explicitStatus: Status.BILLING_GRACE_PERIOD }, now)).toEqual({ kind: 'ok', status: 'past_due' });
    expect(resolveAppleTransactionStatus({ explicitStatus: Status.EXPIRED, expiresDate: past }, now)).toEqual({ kind: 'ok', status: 'canceled' });
  });
});

describe('summarizeHypercashWebhook', () => {
  it('keeps only ids, status and amount - no payer personal data', () => {
    const summary = summarizeHypercashWebhook({
      type: 'transaction.paid',
      data: {
        transaction: {
          id: 'tx_1',
          paymentLinkId: 'link_1',
          status: 'paid',
          amount: 4990,
          customer: { name: 'Ana Souza', email: 'ana@example.com', document: '12345678900' },
        },
      },
    });
    expect(summary).toContain('type: transaction.paid');
    expect(summary).toContain('transaction.paymentLinkId: link_1');
    expect(summary).toContain('transaction.amount: 4990');
    expect(summary).not.toContain('ana@example.com');
    expect(summary).not.toContain('Ana Souza');
    expect(summary).not.toContain('12345678900');
  });

  it('handles empty/garbage bodies', () => {
    expect(summarizeHypercashWebhook(undefined)).toBe('(payload sem campos reconhecidos)');
    expect(summarizeHypercashWebhook('x')).toBe('(payload sem campos reconhecidos)');
  });
});
