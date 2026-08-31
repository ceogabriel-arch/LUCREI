import { describe, expect, it } from 'vitest';

import { allocateLineItem, computeLineProfit, computeOrderTotals } from './order-math';

describe('computeOrderTotals', () => {
  it('sums item value, clamps net shipping at zero, and adds up Shopee fees', () => {
    const totals = computeOrderTotals(
      [
        { item_id: 1, quantity_purchased: 2, discounted_price: 50 },
        { item_id: 2, quantity_purchased: 1, discounted_price: 30 },
      ],
      20, // actual_shipping_fee
      12, // buyer_paid_shipping_fee
      5, // commission_fee
      3 // service_fee
    );

    expect(totals).toEqual({
      totalItemValue: 130, // 2*50 + 1*30
      netShippingCost: 8, // 20 - 12
      totalShopeeFee: 8, // 5 + 3
    });
  });

  it('never returns a negative net shipping cost, even if the buyer paid more than the actual fee', () => {
    const totals = computeOrderTotals([], 10, 25, 0, 0);
    expect(totals.netShippingCost).toBe(0);
  });
});

describe('allocateLineItem', () => {
  it('splits shipping and Shopee fees proportionally to each line\'s share of the order value', () => {
    const totals = { totalItemValue: 100, netShippingCost: 10, totalShopeeFee: 20 };

    const result = allocateLineItem({ item_id: 1, quantity_purchased: 1, discounted_price: 75 }, totals);

    expect(result.lineValue).toBe(75);
    expect(result.shippingFeeAllocated).toBeCloseTo(7.5);
    expect(result.shopeeFeeAllocated).toBeCloseTo(15);
  });

  it('falls back to a zero share instead of dividing by zero when the order has no item value', () => {
    const totals = { totalItemValue: 0, netShippingCost: 10, totalShopeeFee: 20 };

    const result = allocateLineItem({ item_id: 1, quantity_purchased: 1, discounted_price: 0 }, totals);

    expect(result.shippingFeeAllocated).toBe(0);
    expect(result.shopeeFeeAllocated).toBe(0);
  });
});

describe('computeLineProfit', () => {
  it('subtracts shipping, fees, and product cost from the line value', () => {
    expect(computeLineProfit(100, 10, 5, 40)).toBe(45);
  });

  it('returns null when there is no product cost snapshot (cost not registered yet)', () => {
    expect(computeLineProfit(100, 10, 5, null)).toBeNull();
  });
});
