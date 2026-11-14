import type { Shop } from '@prisma/client';

import { getOrder as getMercadoLivreOrder } from '../mercadolivre-client';
import { getOrderDetail } from '../shopee-client';
import { getValidAccessToken as getValidMercadoLivreAccessToken } from './mercadolivre-token';
import { pendingWhereForShop, pendingWindowStart } from './pending-orders';
import { prisma } from './prisma';
import { getValidAccessToken } from './shopee-token';
import { getValidAccessToken as getValidTiktokShopAccessToken } from './tiktokshop-token';
import { getOrders as getTiktokShopOrders } from '../tiktokshop-client';

export type PendingProductOrder = { orderSn: string; status: string; orderDate: Date; quantity: number };

// Pedido pendente (ver pendingWhereForShop) ainda não tem OrderLineItem - só
// dá pra saber quais produtos tem dentro buscando ao vivo no marketplace.
// Mercado Livre: order_items traz item.id, então o match com itemId é exato.
// Shopee: get_order_detail NÃO expõe item_id no item_list (só item_name) -
// o match aqui é por nome igual (sem diferenciar variação), best-effort
// igual o resto da previsão (ver fetchProductLabels em order-forecast/routes.ts).
// Loja sem token válido ou API fora do ar não derruba o relatório - só some
// os pendentes dessa loja em vez de quebrar a exportação/tela inteira.
export async function listPendingOrdersForProduct(
  shop: Shop,
  itemId: string,
  productName: string
): Promise<PendingProductOrder[]> {
  const events = await prisma.recentOrderEvent.findMany({
    where: { ...pendingWhereForShop(shop), orderDate: { gte: pendingWindowStart() } },
    orderBy: { orderDate: 'asc' },
  });
  if (events.length === 0) return [];

  if (shop.provider === 'mercado_livre') {
    const results = await Promise.all(
      events
        .filter((e) => e.mercadoLivreOrderId)
        .map(async (e): Promise<PendingProductOrder | null> => {
          try {
            const { accessToken } = await getValidMercadoLivreAccessToken(shop.id);
            const order = await getMercadoLivreOrder(accessToken, Number(e.mercadoLivreOrderId));
            const quantity = (order.order_items ?? [])
              .filter((it) => it.item.id === itemId)
              .reduce((sum, it) => sum + it.quantity, 0);
            if (quantity === 0) return null;
            return { orderSn: e.mercadoLivreOrderId!, status: e.orderStatus, orderDate: e.orderDate, quantity };
          } catch {
            return null;
          }
        })
    );
    return results.filter((r): r is PendingProductOrder => r !== null);
  }

  // TikTok Shop: line_items trazem product_id, então o match com itemId é
  // exato (igual o Mercado Livre) - e tem multiget, até 50 pedidos por vez.
  if (shop.provider === 'tiktok_shop') {
    try {
      const { accessToken, shopCipher } = await getValidTiktokShopAccessToken(shop.id);
      const ids = events.map((e) => e.tiktokShopOrderId).filter((id): id is string => !!id);
      const eventById = new Map(events.map((e) => [e.tiktokShopOrderId, e]));
      const rows: PendingProductOrder[] = [];
      for (let i = 0; i < ids.length; i += 50) {
        const orders = await getTiktokShopOrders(accessToken, shopCipher, ids.slice(i, i + 50));
        for (const order of orders) {
          const event = eventById.get(order.id);
          if (!event) continue;
          const quantity = (order.line_items ?? [])
            .filter((li) => li.product_id === itemId)
            .reduce((sum, li) => sum + (li.quantity && li.quantity > 0 ? li.quantity : 1), 0);
          if (quantity === 0) continue;
          rows.push({ orderSn: order.id, status: event.orderStatus, orderDate: event.orderDate, quantity });
        }
      }
      return rows;
    } catch {
      return [];
    }
  }

  try {
    const { accessToken, shopeeShopId } = await getValidAccessToken(shop.id);
    const sns = events.map((e) => e.shopeeOrderSn).filter((sn): sn is string => !!sn);
    if (sns.length === 0) return [];

    const orderList = await getOrderDetail(accessToken, shopeeShopId, sns, ['item_list']);
    const eventBySn = new Map(events.map((e) => [e.shopeeOrderSn, e]));
    const normalizedName = productName.trim().toLowerCase();

    const rows: PendingProductOrder[] = [];
    for (const order of orderList) {
      const event = eventBySn.get(order.order_sn);
      if (!event) continue;
      const quantity = (order.item_list ?? [])
        .filter((it) => it.item_name.trim().toLowerCase() === normalizedName)
        .reduce((sum, it) => sum + (it.model_quantity_purchased ?? it.quantity_purchased ?? 1), 0);
      if (quantity === 0) continue;
      rows.push({ orderSn: order.order_sn, status: event.orderStatus, orderDate: event.orderDate, quantity });
    }
    return rows;
  } catch {
    return [];
  }
}
