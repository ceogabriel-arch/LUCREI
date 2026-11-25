import type { Food99OrderItem } from '../../food99-client';

export type Food99OrderTotals = { totalItemValue: number };

// real_price do item já vem líquido de promoção do item e já multiplicado
// pela quantidade (diferente da Shopee/iFood, que mandam preço por unidade) -
// ver "Response Body Parameters - Order items" na documentação da 99Food.
function itemValue(item: Food99OrderItem): number {
  return item.real_price ?? item.total_price ?? item.sku_price * item.amount;
}

export function computeFood99OrderTotals(items: Food99OrderItem[]): Food99OrderTotals {
  return { totalItemValue: items.reduce((sum, it) => sum + itemValue(it), 0) };
}

// Diferente de Shopee/ML (taxa vem junto no pedido) e mais parecido com
// iFood: a comissão/taxa de entrega real da 99Food só é conhecida depois,
// pela Financial API (ver food99-financial-watchdog.ts) - no momento do
// pedido (webhook orderNew), feeAllocated/shippingFeeAllocated começam em 0 e
// são preenchidos quando a reconciliação financeira roda pra esse pedido.
export function allocateFood99LineItem(item: Food99OrderItem, totals: Food99OrderTotals) {
  const lineValue = itemValue(item);
  const share = totals.totalItemValue > 0 ? lineValue / totals.totalItemValue : 0;
  return { lineValue, share };
}

// Taxas totais cobradas pela 99Food num pedido (comissão + logística B2P +
// taxa de processamento de pagamento + imposto sobre a comissão) - todos já
// vêm em valor absoluto (ver Math.abs em food99-client). Distribuídas entre
// as linhas do pedido proporcionalmente ao valor de cada uma, igual já é
// feito pra Shopee (allocateLineItem em order-math.ts).
export function totalFood99Fees(row: {
  commissionAmount: number;
  b2pDeliveryAmount: number;
  payCommissionAmount: number;
  vatAmount: number;
}): number {
  return row.commissionAmount + row.b2pDeliveryAmount + row.payCommissionAmount + row.vatAmount;
}
