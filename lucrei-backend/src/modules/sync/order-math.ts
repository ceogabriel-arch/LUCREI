export type IncomeItem = {
  item_id: number;
  quantity_purchased: number;
  discounted_price: number;
};

export type OrderTotals = {
  totalItemValue: number;
  netShippingCost: number;
  totalShopeeFee: number;
};

export function computeOrderTotals(
  items: IncomeItem[],
  actualShippingFee: number,
  buyerPaidShippingFee: number,
  commissionFee: number,
  serviceFee: number
): OrderTotals {
  const totalItemValue = items.reduce((sum, item) => sum + item.discounted_price * item.quantity_purchased, 0);
  const netShippingCost = Math.max(actualShippingFee - buyerPaidShippingFee, 0);
  const totalShopeeFee = commissionFee + serviceFee;

  return { totalItemValue, netShippingCost, totalShopeeFee };
}

export function allocateLineItem(item: IncomeItem, totals: OrderTotals) {
  const lineValue = item.discounted_price * item.quantity_purchased;
  const share = totals.totalItemValue > 0 ? lineValue / totals.totalItemValue : 0;

  return {
    lineValue,
    shippingFeeAllocated: totals.netShippingCost * share,
    shopeeFeeAllocated: totals.totalShopeeFee * share,
  };
}

export function computeLineProfit(
  lineValue: number,
  shippingFeeAllocated: number,
  shopeeFeeAllocated: number,
  productCostSnapshot: number | null
): number | null {
  if (productCostSnapshot === null) return null;
  return lineValue - shippingFeeAllocated - shopeeFeeAllocated - productCostSnapshot;
}
