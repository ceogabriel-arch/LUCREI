import { describe, expect, it } from 'vitest';

import { allocateTiktokLineItem, computeTiktokOrderCosts, groupTiktokLineItems, toAmount } from './tiktokshop-order-math';

describe('toAmount', () => {
  it('parses string amounts and falls back to 0 on garbage', () => {
    expect(toAmount('19.90')).toBeCloseTo(19.9);
    expect(toAmount(undefined)).toBe(0);
    expect(toAmount('abc')).toBe(0);
  });
});

describe('groupTiktokLineItems', () => {
  it('groups one-unit line items of the same SKU into a single line with quantity', () => {
    const grouped = groupTiktokLineItems([
      { id: 'a', product_id: 'p1', sku_id: 's1', product_name: 'Camisa', sku_name: 'G', sale_price: '20' },
      { id: 'b', product_id: 'p1', sku_id: 's1', product_name: 'Camisa', sku_name: 'G', sale_price: '20' },
      { id: 'c', product_id: 'p2', sku_id: 's2', product_name: 'Boné', sale_price: '15' },
    ]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]).toMatchObject({ productId: 'p1', quantity: 2, unitPrice: 20, name: 'Camisa - G' });
    expect(grouped[1]).toMatchObject({ productId: 'p2', quantity: 1, unitPrice: 15, name: 'Boné' });
  });

  it('uses a weighted average price when units of the same SKU have different prices', () => {
    const [line] = groupTiktokLineItems([
      { id: 'a', product_id: 'p1', sku_id: 's1', sale_price: '10' },
      { id: 'b', product_id: 'p1', sku_id: 's1', sale_price: '20' },
    ]);
    expect(line.quantity).toBe(2);
    expect(line.unitPrice).toBe(15);
  });

  it('respects an explicit quantity when the API sends one', () => {
    const [line] = groupTiktokLineItems([{ id: 'a', product_id: 'p1', sale_price: '10', quantity: 3 }]);
    expect(line.quantity).toBe(3);
  });
});

describe('computeTiktokOrderCosts', () => {
  it('sums absolute fee and shipping amounts across statement transactions', () => {
    const costs = computeTiktokOrderCosts([
      { fee_amount: '-5.50', shipping_cost_amount: '-8' },
      { fee_amount: '1.5' },
    ]);
    expect(costs.totalFee).toBeCloseTo(7);
    expect(costs.shippingCost).toBe(8);
  });

  it('returns zero costs when there is no statement yet', () => {
    expect(computeTiktokOrderCosts([])).toEqual({ totalFee: 0, shippingCost: 0 });
  });
});

describe('allocateTiktokLineItem', () => {
  it('splits order-level fee and shipping proportionally to line value', () => {
    const item = { productId: 'p1', skuId: null, name: 'A', quantity: 3, unitPrice: 25 };
    const result = allocateTiktokLineItem(item, 100, { totalFee: 10, shippingCost: 20 });
    expect(result.lineValue).toBe(75);
    expect(result.feeAllocated).toBeCloseTo(7.5);
    expect(result.shippingFeeAllocated).toBeCloseTo(15);
  });

  it('allocates nothing when the order has no item value', () => {
    const item = { productId: 'p1', skuId: null, name: 'A', quantity: 1, unitPrice: 0 };
    const result = allocateTiktokLineItem(item, 0, { totalFee: 10, shippingCost: 20 });
    expect(result.feeAllocated).toBe(0);
    expect(result.shippingFeeAllocated).toBe(0);
  });
});
