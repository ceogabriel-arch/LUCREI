export type MLOrderItem = {
  item: { id: string; title: string };
  quantity: number;
  unit_price: number;
  // Não confirmado ainda contra um pedido real com venda de verdade (ver
  // nota em mercadolivre-client/index.ts) - assumindo que é por UNIDADE,
  // igual unit_price, não já multiplicado pela quantidade.
  sale_fee?: number;
};

export type MLOrderTotals = {
  totalItemValue: number;
};

export function computeMLOrderTotals(items: MLOrderItem[]): MLOrderTotals {
  const totalItemValue = items.reduce((sum, it) => sum + it.unit_price * it.quantity, 0);
  return { totalItemValue };
}

// Diferente da Shopee (uma taxa só por pedido, que precisa ser dividida
// proporcionalmente entre os itens), o Mercado Livre já devolve sale_fee
// por item - não precisa alocar nada aí, só multiplicar pela quantidade. O
// frete, esse sim, é só por pedido (via shipment), então segue precisando
// da mesma alocação proporcional por valor de item que a Shopee usa.
export function allocateMLLineItem(item: MLOrderItem, totals: MLOrderTotals, orderShippingCost: number) {
  const lineValue = item.unit_price * item.quantity;
  const share = totals.totalItemValue > 0 ? lineValue / totals.totalItemValue : 0;

  return {
    lineValue,
    feeAllocated: (item.sale_fee ?? 0) * item.quantity,
    shippingFeeAllocated: orderShippingCost * share,
  };
}
