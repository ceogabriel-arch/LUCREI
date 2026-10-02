import type { Shop } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { formatOrderProductLabel } from '../../lib/order-product-label';
import { getValidAccessToken as getValidMercadoLivreAccessToken } from '../../lib/mercadolivre-token';
import { rangeStart } from '../../lib/period';
import { prisma } from '../../lib/prisma';
import { getValidAccessToken } from '../../lib/shopee-token';
import { getOrder as getMercadoLivreOrder } from '../../mercadolivre-client';
import { getOrderDetail } from '../../shopee-client';
import { ML_RESOLVED_STATUSES } from '../sync/mercadolivre-service';
import { computeShopSummary } from '../summary/routes';

// Pedido nesses status não vai virar lucro (já concluiu por outro caminho,
// foi cancelado, ou está sendo cancelado) - não entra na contagem de
// "ainda em processamento". Equivalente ML é ML_RESOLVED_STATUSES.
const SHOPEE_RESOLVED_STATUSES = ['COMPLETED', 'CANCELLED', 'IN_CANCEL'];

// Pedido pendente há mais tempo que isso provavelmente perdeu o rastro (push
// da Shopee não garante entrega, e o sync periódico do ML só vê o que ainda
// está nas primeiras páginas de busca) - não entra mais na previsão pra não
// inflar a contagem pra sempre com pedido "fantasma".
const PENDING_WINDOW_START = () => rangeStart('30d');

type ShopForecast = { pendingCount: number; projectedProfit: number };
type PendingEvent = {
  shopeeOrderSn: string | null;
  mercadoLivreOrderId: string | null;
  orderStatus: string;
  orderDate: Date;
  shopId: string;
};

// Lucro médio por pedido concluído recentemente - a taxa/frete exatos de um
// pedido ainda em processamento só existem depois que ele completa de
// verdade, então isso é sempre uma estimativa (a mesma média aplicada em
// cada pedido pendente da loja), nunca um valor garantido por pedido.
async function computeAvgProfitPerOrder(shop: Shop): Promise<number> {
  const recentSummary = await computeShopSummary(shop, { period: '30d' });
  return recentSummary.ordersCount > 0 ? recentSummary.profit / recentSummary.ordersCount : 0;
}

function pendingWhereForShop(shop: Shop) {
  return shop.provider === 'mercado_livre'
    ? { shopId: shop.id, mercadoLivreOrderId: { not: null }, orderStatus: { notIn: [...ML_RESOLVED_STATUSES] } }
    : { shopId: shop.id, shopeeOrderSn: { not: null }, orderStatus: { notIn: SHOPEE_RESOLVED_STATUSES } };
}

async function computeShopForecast(shop: Shop): Promise<ShopForecast> {
  const pendingCount = await prisma.recentOrderEvent.count({
    where: { ...pendingWhereForShop(shop), orderDate: { gte: PENDING_WINDOW_START() } },
  });

  if (pendingCount === 0) return { pendingCount: 0, projectedProfit: 0 };

  const avgProfitPerOrder = await computeAvgProfitPerOrder(shop);
  return { pendingCount, projectedProfit: pendingCount * avgProfitPerOrder };
}

// Lista (não só conta) os pedidos pendentes - usado pelo detalhe que abre ao
// tocar no card de previsão. Mais antigo primeiro, pra chamar atenção pro
// que está parado há mais tempo.
async function listPendingOrders(shops: Shop[]): Promise<PendingEvent[]> {
  if (shops.length === 0) return [];
  return prisma.recentOrderEvent.findMany({
    where: { OR: shops.map((shop) => ({ ...pendingWhereForShop(shop), orderDate: { gte: PENDING_WINDOW_START() } })) },
    orderBy: { orderDate: 'asc' },
    select: { shopeeOrderSn: true, mercadoLivreOrderId: true, orderStatus: true, orderDate: true, shopId: true },
  });
}

function orderKey(e: PendingEvent): string {
  return (e.shopeeOrderSn ?? e.mercadoLivreOrderId)!;
}

// Pedido ainda em processamento nunca está na tabela Order (só sincroniza
// pedido já resolvido) - então o nome do produto só existe buscando ao vivo
// em cada marketplace. Shopee: get_order_detail com item_list (uma chamada
// por loja, multiget). Mercado Livre: não tem multiget de pedido, então é
// uma chamada por pedido (lista de pendentes costuma ser pequena) - mas o
// nome do item já vem dentro da própria resposta de get_order, sem precisar
// de catálogo à parte. Loja com token expirado/erro não derruba as outras.
async function fetchProductLabels(events: PendingEvent[], shops: Shop[]): Promise<Map<string, string>> {
  const labelByKey = new Map<string, string>();
  const shopById = new Map(shops.map((s) => [s.id, s]));

  const snsByShop = new Map<string, string[]>();
  for (const e of events) {
    if (!e.shopeeOrderSn) continue;
    snsByShop.set(e.shopId, [...(snsByShop.get(e.shopId) ?? []), e.shopeeOrderSn]);
  }

  await Promise.all([
    ...[...snsByShop.entries()].map(async ([shopId, sns]) => {
      try {
        const { accessToken, shopeeShopId } = await getValidAccessToken(shopId);
        const orderList = await getOrderDetail(accessToken, shopeeShopId, sns, ['item_list']);
        for (const order of orderList) {
          const items = (order.item_list ?? [])
            .map((it) => ({ quantity: it.model_quantity_purchased ?? it.quantity_purchased ?? 1, name: it.item_name }))
            .filter((it): it is { quantity: number; name: string } => !!it.name);
          const label = formatOrderProductLabel(items);
          if (label) labelByKey.set(order.order_sn, label);
        }
      } catch {
        // Loja sem token válido ou API fora do ar - o pedido ainda aparece na
        // lista, só sem o nome do produto.
      }
    }),
    ...events
      .filter((e) => e.mercadoLivreOrderId)
      .map(async (e) => {
        const shop = shopById.get(e.shopId);
        if (!shop) return;
        try {
          const { accessToken } = await getValidMercadoLivreAccessToken(shop.id);
          const order = await getMercadoLivreOrder(accessToken, Number(e.mercadoLivreOrderId));
          const items = (order.order_items ?? [])
            .map((it) => ({ quantity: it.quantity, name: it.item.title }))
            .filter((it): it is { quantity: number; name: string } => !!it.name);
          const label = formatOrderProductLabel(items);
          if (label) labelByKey.set(e.mercadoLivreOrderId!, label);
        } catch {
          // idem - sem token válido ou API fora do ar, pedido segue sem label.
        }
      }),
  ]);

  return labelByKey;
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

      return computeShopForecast(shop);
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

      const events = await listPendingOrders([shop]);
      const [labelByKey, avgProfitPerOrder] = await Promise.all([
        fetchProductLabels(events, [shop]),
        computeAvgProfitPerOrder(shop),
      ]);
      return events.map((e) => ({
        orderSn: orderKey(e),
        status: e.orderStatus,
        orderDate: e.orderDate,
        provider: shop.provider,
        product: labelByKey.get(orderKey(e)) ?? null,
        estimatedProfit: avgProfitPerOrder,
      }));
    }
  );

  // Soma a previsão de todas as lojas ativas da conta - usado pelo "Todas as
  // lojas" no Início, igual /summary.
  app.get('/order-forecast', { onRequest: [app.authenticate] }, async (request) => {
    const shops = await prisma.shop.findMany({ where: { userId: request.user.sub, status: 'active' } });
    if (shops.length === 0) return { pendingCount: 0, projectedProfit: 0 };

    const forecasts = await Promise.all(shops.map((shop) => computeShopForecast(shop)));
    return {
      pendingCount: forecasts.reduce((sum, f) => sum + f.pendingCount, 0),
      projectedProfit: forecasts.reduce((sum, f) => sum + f.projectedProfit, 0),
    };
  });

  app.get('/order-forecast/pending', { onRequest: [app.authenticate] }, async (request) => {
    const shops = await prisma.shop.findMany({ where: { userId: request.user.sub, status: 'active' } });
    if (shops.length === 0) return [];

    const events = await listPendingOrders(shops);
    const shopById = new Map(shops.map((s) => [s.id, s]));
    const [labelByKey, avgProfitEntries] = await Promise.all([
      fetchProductLabels(events, shops),
      Promise.all(shops.map(async (shop) => [shop.id, await computeAvgProfitPerOrder(shop)] as const)),
    ]);
    const avgProfitByShop = new Map(avgProfitEntries);
    return events.map((e) => ({
      orderSn: orderKey(e),
      status: e.orderStatus,
      orderDate: e.orderDate,
      shopName: shopById.get(e.shopId)?.shopName ?? '',
      provider: shopById.get(e.shopId)?.provider ?? 'shopee',
      product: labelByKey.get(orderKey(e)) ?? null,
      estimatedProfit: avgProfitByShop.get(e.shopId) ?? 0,
    }));
  });
}
