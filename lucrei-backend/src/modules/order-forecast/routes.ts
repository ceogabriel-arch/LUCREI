import type { Shop } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { formatOrderProductLabel } from '../../lib/order-product-label';
import { rangeStart } from '../../lib/period';
import { prisma } from '../../lib/prisma';
import { getValidAccessToken } from '../../lib/shopee-token';
import { getOrderDetail } from '../../shopee-client';
import { computeShopSummary } from '../summary/routes';

// Pedido nesses status não vai virar lucro (já concluiu por outro caminho,
// foi cancelado, ou está sendo cancelado) - não entra na contagem de
// "ainda em processamento".
const RESOLVED_STATUSES = ['COMPLETED', 'CANCELLED', 'IN_CANCEL'];

// Pedido pendente há mais tempo que isso provavelmente perdeu o rastro (o
// push da Shopee não é entrega garantida, e a sincronização normal só busca
// pedido já COMPLETED) - não entra mais na previsão pra não inflar a
// contagem pra sempre com pedido "fantasma".
const PENDING_WINDOW_START = () => rangeStart('30d');

type ShopForecast = { pendingCount: number; projectedProfit: number };

// Lucro médio por pedido concluído recentemente - a taxa/frete exatos de um
// pedido ainda em processamento só existem depois que ele completa de
// verdade, então isso é sempre uma estimativa (a mesma média aplicada em
// cada pedido pendente da loja), nunca um valor garantido por pedido.
async function computeAvgProfitPerOrder(shop: Shop): Promise<number> {
  const recentSummary = await computeShopSummary(shop, { period: '30d' });
  return recentSummary.ordersCount > 0 ? recentSummary.profit / recentSummary.ordersCount : 0;
}

async function computeShopForecast(shopId: string): Promise<ShopForecast> {
  const pendingCount = await prisma.recentOrderEvent.count({
    where: {
      shopId,
      orderStatus: { notIn: RESOLVED_STATUSES },
      orderDate: { gte: PENDING_WINDOW_START() },
    },
  });

  if (pendingCount === 0) return { pendingCount: 0, projectedProfit: 0 };

  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return { pendingCount, projectedProfit: 0 };

  const avgProfitPerOrder = await computeAvgProfitPerOrder(shop);
  return { pendingCount, projectedProfit: pendingCount * avgProfitPerOrder };
}

// Lista (não só conta) os pedidos pendentes - usado pelo detalhe que abre ao
// tocar no card de previsão. Mais antigo primeiro, pra chamar atenção pro
// que está parado há mais tempo.
async function listPendingOrders(shopIds: string[]) {
  return prisma.recentOrderEvent.findMany({
    where: {
      shopId: { in: shopIds },
      orderStatus: { notIn: RESOLVED_STATUSES },
      orderDate: { gte: PENDING_WINDOW_START() },
    },
    orderBy: { orderDate: 'asc' },
    select: { shopeeOrderSn: true, orderStatus: true, orderDate: true, shopId: true },
  });
}

// Pedido ainda em processamento nunca está na tabela Order (só sincroniza
// COMPLETED) - então o nome do produto só existe buscando ao vivo na Shopee
// via get_order_detail com item_list, que (diferente do get_escrow_detail)
// vem preenchido em qualquer status. Uma chamada por loja (não por pedido) -
// agrupa antes de buscar. Loja com token expirado/erro não derruba as outras.
async function fetchProductLabels(
  events: { shopeeOrderSn: string; shopId: string }[]
): Promise<Map<string, string>> {
  const labelBySn = new Map<string, string>();
  const snsByShop = new Map<string, string[]>();
  for (const e of events) {
    snsByShop.set(e.shopId, [...(snsByShop.get(e.shopId) ?? []), e.shopeeOrderSn]);
  }

  await Promise.all(
    [...snsByShop.entries()].map(async ([shopId, sns]) => {
      try {
        const { accessToken, shopeeShopId } = await getValidAccessToken(shopId);
        const orderList = await getOrderDetail(accessToken, shopeeShopId, sns, ['item_list']);
        for (const order of orderList) {
          const items = (order.item_list ?? [])
            .map((it) => ({ quantity: it.model_quantity_purchased ?? it.quantity_purchased ?? 1, name: it.item_name }))
            .filter((it): it is { quantity: number; name: string } => !!it.name);
          const label = formatOrderProductLabel(items);
          if (label) labelBySn.set(order.order_sn, label);
        }
      } catch {
        // Loja sem token válido ou API fora do ar - o pedido ainda aparece na
        // lista, só sem o nome do produto.
      }
    })
  );

  return labelBySn;
}

export async function orderForecastRoutes(app: FastifyInstance) {
  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/order-forecast',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      return computeShopForecast(shop.id);
    }
  );

  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/order-forecast/pending',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const events = await listPendingOrders([shop.id]);
      const [labelBySn, avgProfitPerOrder] = await Promise.all([
        fetchProductLabels(events),
        computeAvgProfitPerOrder(shop),
      ]);
      return events.map((e) => ({
        orderSn: e.shopeeOrderSn,
        status: e.orderStatus,
        orderDate: e.orderDate,
        product: labelBySn.get(e.shopeeOrderSn) ?? null,
        estimatedProfit: avgProfitPerOrder,
      }));
    }
  );

  // Soma a previsão de todas as lojas ativas da conta - usado pelo "Todas as
  // lojas" no Início, igual /summary.
  app.get('/order-forecast', { onRequest: [app.authenticate] }, async (request) => {
    const shops = await prisma.shop.findMany({ where: { userId: request.user.sub, status: 'active' } });
    if (shops.length === 0) return { pendingCount: 0, projectedProfit: 0 };

    const forecasts = await Promise.all(shops.map((shop) => computeShopForecast(shop.id)));
    return {
      pendingCount: forecasts.reduce((sum, f) => sum + f.pendingCount, 0),
      projectedProfit: forecasts.reduce((sum, f) => sum + f.projectedProfit, 0),
    };
  });

  app.get('/order-forecast/pending', { onRequest: [app.authenticate] }, async (request) => {
    const shops = await prisma.shop.findMany({ where: { userId: request.user.sub, status: 'active' } });
    if (shops.length === 0) return [];

    const events = await listPendingOrders(shops.map((s) => s.id));
    const shopNameById = new Map(shops.map((s) => [s.id, s.shopName]));
    const [labelBySn, avgProfitEntries] = await Promise.all([
      fetchProductLabels(events),
      Promise.all(shops.map(async (shop) => [shop.id, await computeAvgProfitPerOrder(shop)] as const)),
    ]);
    const avgProfitByShop = new Map(avgProfitEntries);
    return events.map((e) => ({
      orderSn: e.shopeeOrderSn,
      status: e.orderStatus,
      orderDate: e.orderDate,
      shopName: shopNameById.get(e.shopId) ?? '',
      product: labelBySn.get(e.shopeeOrderSn) ?? null,
      estimatedProfit: avgProfitByShop.get(e.shopId) ?? 0,
    }));
  });
}
