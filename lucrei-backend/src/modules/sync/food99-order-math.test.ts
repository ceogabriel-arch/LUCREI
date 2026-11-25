import { describe, expect, it } from 'vitest';

import { allocateFood99LineItem, computeFood99OrderTotals, totalFood99Fees } from './food99-order-math';

describe('computeFood99OrderTotals', () => {
  it('sums real_price across items', () => {
    const totals = computeFood99OrderTotals([
      { app_item_id: 'a', name: 'X', total_price: 1000, sku_price: 1000, amount: 1, real_price: 800 },
      { app_item_id: 'b', name: 'Y', total_price: 500, sku_price: 500, amount: 1, real_price: 500 },
    ]);
    expect(totals.totalItemValue).toBe(1300);
  });

  it('falls back to total_price then sku_price*amount when real_price is missing', () => {
    const totals = computeFood99OrderTotals([
      { app_item_id: 'a', name: 'X', total_price: 1000, sku_price: 500, amount: 2 } as never,
    ]);
    expect(totals.totalItemValue).toBe(1000);
  });
});

describe('allocateFood99LineItem', () => {
  it('computes each line share of the order total', () => {
    const totals = computeFood99OrderTotals([
      { app_item_id: 'a', name: 'X', total_price: 800, sku_price: 800, amount: 1, real_price: 800 },
      { app_item_id: 'b', name: 'Y', total_price: 200, sku_price: 200, amount: 1, real_price: 200 },
    ]);
    const { lineValue, share } = allocateFood99LineItem(
      { app_item_id: 'a', name: 'X', total_price: 800, sku_price: 800, amount: 1, real_price: 800 },
      totals
    );
    expect(lineValue).toBe(800);
    expect(share).toBeCloseTo(0.8);
  });

  it('allocates nothing when the order has no item value', () => {
    const { share } = allocateFood99LineItem(
      { app_item_id: 'a', name: 'X', total_price: 0, sku_price: 0, amount: 1, real_price: 0 },
      { totalItemValue: 0 }
    );
    expect(share).toBe(0);
  });
});

describe('totalFood99Fees', () => {
  it('sums all fee components', () => {
    expect(
      totalFood99Fees({ commissionAmount: 100, b2pDeliveryAmount: 50, payCommissionAmount: 10, vatAmount: 5 })
    ).toBe(165);
  });
});
