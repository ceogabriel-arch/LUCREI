export type IfoodOrderItem = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

export type IfoodOrderTotals = {
  totalItemValue: number;
};

export function computeIfoodOrderTotals(items: IfoodOrderItem[]): IfoodOrderTotals {
  const totalItemValue = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
  return { totalItemValue };
}

// A iFood não manda a comissão dela no pedido (diferente do sale_fee da
// Shopee/ML) - vem do contrato da loja com a iFood, por isso é configurada
// manualmente (Shop.ifoodCommissionPercent) e aplicada aqui como % sobre o
// valor de cada item, igual o imposto (computeTaxAllocated em order-math.ts)
// já faz. A taxa de entrega só entra no cálculo quando o PRÓPRIO lojista
// banca a entrega (deliveryFeeToSeller vem 0 pra entrega feita pela iFood).
export function allocateIfoodLineItem(
  item: IfoodOrderItem,
  totals: IfoodOrderTotals,
  commissionPercent: number,
  deliveryFeeToSeller: number
) {
  const lineValue = item.unitPrice * item.quantity;
  const share = totals.totalItemValue > 0 ? lineValue / totals.totalItemValue : 0;

  return {
    lineValue,
    feeAllocated: lineValue * (commissionPercent / 100),
    shippingFeeAllocated: deliveryFeeToSeller * share,
  };
}
