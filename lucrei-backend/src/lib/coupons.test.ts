import { describe, expect, it } from 'vitest';

import { applyPercentOff } from './coupons';

describe('applyPercentOff', () => {
  it('applies a whole percentage off', () => {
    expect(applyPercentOff(100, 20)).toBe(80);
  });

  it('rounds to two decimal places without floating point drift', () => {
    expect(applyPercentOff(29.9, 50)).toBe(14.95);
    expect(applyPercentOff(19.9, 15)).toBe(16.92);
  });

  it('returns 0 for a 100% off coupon', () => {
    expect(applyPercentOff(199.9, 100)).toBe(0);
  });
});
