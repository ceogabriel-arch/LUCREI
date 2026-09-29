import type { FastifyInstance } from 'fastify';

import { rangeStart } from '../../lib/period';
import { prisma } from '../../lib/prisma';
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

async function computeShopForecast(shopId: string): Promise<ShopForecast> {
  const pendingCount = await prisma.recentOrderEvent.count({
    where: {
      shopId,
      orderStatus: { notIn: RESOLVED_STATUSES },
      orderDate: { gte: PENDING_WINDOW_START() },
    },
  });

  if (pendingCount === 0) return { pendingCount: 0, projectedProfit: 0 };

  // Lucro médio por pedido concluído recentemente - a taxa/frete exatos de
  // um pedido ainda em processamento só existem depois que ele completa de
  // verdade, então isso é sempre uma estimativa, nunca um valor garantido.
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return { pendingCount, projectedProfit: 0 };

  const recentSummary = await computeShopSummary(shop, { period: '30d' });
  const avgProfitPerOrder = recentSummary.ordersCount > 0 ? recentSummary.profit / recentSummary.ordersCount : 0;

  return { pendingCount, projectedProfit: pendingCount * avgProfitPerOrder };
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
}
