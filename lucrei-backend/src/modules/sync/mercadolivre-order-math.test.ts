import { describe, expect, it } from 'vitest';

import { allocateMLLineItem, computeMLOrderTotals } from './mercadolivre-order-math';

describe('computeMLOrderTotals', () => {
  it('sums item value (unit_price * quantity) across items', () => {
    const totals = computeMLOrderTotals([
      { item: { id: '1', title: 'A' }, quantity: 2, unit_price: 50 },
      { item: { id: '2', title: 'B' }, quantity: 1, unit_price: 30 },
    ]);
    expect(totals.totalItemValue).toBe(130); // 2*50 + 1*30
  });
});

describe('allocateMLLineItem', () => {
  it('uses sale_fee directly (already per item, no allocation needed) and splits shipping proportionally', () => {
    const totals = { totalItemValue: 100 };
    const item = { item: { id: '1', title: 'A' }, quantity: 1, unit_price: 75, sale_fee: 10 };

    const result = allocateMLLineItem(item, totals, 20);

    expect(result.lineValue).toBe(75);
    expect(result.feeAllocated).toBe(10); // sale_fee * quantity, not divided
    expect(result.shippingFeeAllocated).toBeCloseTo(15); // 75/100 * 20
  });

  it('multiplies sale_fee by quantity for multi-unit lines', () => {
    const totals = { totalItemValue: 100 };
    const item = { item: { id: '1', title: 'A' }, quantity: 3, unit_price: 20, sale_fee: 2 };

    const result = allocateMLLineItem(item, totals, 0);

    expect(result.lineValue).toBe(60);
    expect(result.feeAllocated).toBe(6); // 2 * 3
  });

  it('falls back to a zero fee/share when sale_fee is missing or order has no item value', () => {
    const result = allocateMLLineItem({ item: { id: '1', title: 'A' }, quantity: 1, unit_price: 0 }, { totalItemValue: 0 }, 10);
    expect(result.feeAllocated).toBe(0);
    expect(result.shippingFeeAllocated).toBe(0);
  });
});
