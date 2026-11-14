import type { TiktokLineItem, TiktokStatementTransaction } from '../../tiktokshop-client';

export type TiktokGroupedItem = {
  productId: string;
  skuId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
};

// Valor monetário vem como string na API do TikTok Shop ("19.90") - qualquer
// coisa que não vire número conta como 0 em vez de quebrar o pedido inteiro.
export function toAmount(value: string | number | undefined | null): number {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// Pela documentação (não confirmado contra pedido real), cada line_item é UMA
// unidade - 3 unidades do mesmo SKU chegam como 3 line_items. Agrupa por
// produto+SKU pra virar uma linha só com quantidade, igual Shopee/ML. Se a API
// mandar "quantity" no item, respeita em vez de assumir 1.
export function groupTiktokLineItems(lineItems: TiktokLineItem[]): TiktokGroupedItem[] {
  const groups = new Map<string, TiktokGroupedItem>();
  for (const li of lineItems) {
    const key = `${li.product_id}:${li.sku_id ?? ''}`;
    const quantity = li.quantity && li.quantity > 0 ? li.quantity : 1;
    const unitPrice = toAmount(li.sale_price ?? li.original_price);
    const existing = groups.get(key);
    if (existing) {
      // Preço médio ponderado - unidades do mesmo SKU podem ter descontos
      // diferentes entre si.
      const total = existing.unitPrice * existing.quantity + unitPrice * quantity;
      existing.quantity += quantity;
      existing.unitPrice = total / existing.quantity;
    } else {
      groups.set(key, {
        productId: li.product_id,
        skuId: li.sku_id ?? null,
        name: li.sku_name ? `${li.product_name ?? 'Produto'} - ${li.sku_name}` : (li.product_name ?? 'Produto'),
        quantity,
        unitPrice,
      });
    }
  }
  return [...groups.values()];
}

export type TiktokOrderCosts = { totalFee: number; shippingCost: number };

// Taxa da plataforma e frete do vendedor vêm do extrato financeiro do pedido
// (formato não confirmado). Os valores podem vir negativos (débito) - usa o
// absoluto. Sem extrato ainda (pedido não repassado) = 0, o que superestima o
// lucro até o próximo sync dentro da janela reprocessar o pedido com o
// extrato pronto.
export function computeTiktokOrderCosts(transactions: TiktokStatementTransaction[]): TiktokOrderCosts {
  let totalFee = 0;
  let shippingCost = 0;
  for (const t of transactions) {
    totalFee += Math.abs(toAmount(t.fee_amount));
    shippingCost += Math.abs(toAmount(t.shipping_cost_amount));
  }
  return { totalFee, shippingCost };
}

// Mesma alocação proporcional por valor de item que a Shopee usa - taxa e
// frete do TikTok Shop são por pedido, não por item.
export function allocateTiktokLineItem(item: TiktokGroupedItem, totalItemValue: number, costs: TiktokOrderCosts) {
  const lineValue = item.unitPrice * item.quantity;
  const share = totalItemValue > 0 ? lineValue / totalItemValue : 0;
  return {
    lineValue,
    feeAllocated: costs.totalFee * share,
    shippingFeeAllocated: costs.shippingCost * share,
  };
}
