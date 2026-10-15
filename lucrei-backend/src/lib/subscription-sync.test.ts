import { describe, expect, it } from 'vitest';

import { mapHypercashStatus, mapMercadoPagoStatus } from './subscription-sync';

describe('mapHypercashStatus', () => {
  it('maps active to active', () => {
    expect(mapHypercashStatus('active')).toBe('active');
  });

  it('maps paused and payment_failed to past_due (carência, não cancela de vez)', () => {
    expect(mapHypercashStatus('paused')).toBe('past_due');
    expect(mapHypercashStatus('payment_failed')).toBe('past_due');
  });

  it('maps cancelled and expired to canceled', () => {
    expect(mapHypercashStatus('cancelled')).toBe('canceled');
    expect(mapHypercashStatus('expired')).toBe('canceled');
  });
});

describe('mapMercadoPagoStatus', () => {
  it('maps the known statuses', () => {
    expect(mapMercadoPagoStatus('authorized')).toBe('active');
    expect(mapMercadoPagoStatus('paused')).toBe('past_due');
    expect(mapMercadoPagoStatus('cancelled')).toBe('canceled');
  });

  it('returns null for an unknown status', () => {
    expect(mapMercadoPagoStatus('whatever')).toBeNull();
  });
});
