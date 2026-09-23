import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { rangeStart, type Period } from '../../lib/period';

export async function summaryRoutes(app: FastifyInstance) {
  app.get<{ Params: { shopId: string }; Querystring: { period?: Period; from?: string; to?: string } }>(
    '/shops/:shopId/summary',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      // from/to (usado pelo relatório por ano/mês) manda mais que period -
      // permite um intervalo arbitrário em vez dos presets fixos.
      const fromDate = request.query.from ? new Date(request.query.from) : null;
      const toDate = request.query.to ? new Date(request.query.to) : null;

      const period = request.query.period ?? '30d';
      // "all" (usado pro lucro vitalício das recompensas) não pode contar
      // pedidos de antes de conectar a loja no Lucrei - senão uma loja com
      // histórico de vendas na Shopee desbloquearia recompensa na hora de
      // conectar, sem o usuário ter usado o app pra nada ainda. Esse caso
      // continua olhando orderDate (data da compra) de propósito - é sobre
      // quando a VENDA aconteceu em relação a conectar a loja, não sobre
      // quando o lucro ficou confirmado.
      const isLifetimeRewardsQuery = !fromDate && period === 'all';
      const start = fromDate ?? (period === 'all' ? shop.connectedAt : rangeStart(period));

      // Demais casos (presets Hoje/7 dias/30 dias e o from/to dos relatórios
      // por mês/ano) filtram por completedAt: o lucro só existe de fato
      // depois do pedido completar, então "Hoje" precisa dizer "completou
      // hoje", não "foi comprado hoje" (que normalmente é outro dia).
      const orders = isLifetimeRewardsQuery
        ? await prisma.order.findMany({
            where: { shopId: shop.id, orderDate: { gte: start, ...(toDate ? { lt: toDate } : {}) } },
            include: { lineItems: true },
            orderBy: { orderDate: 'asc' },
          })
        : await prisma.order.findMany({
            where: { shopId: shop.id, completedAt: { gte: start, ...(toDate ? { lt: toDate } : {}) } },
            include: { lineItems: true },
            orderBy: { orderDate: 'asc' },
          });

      let revenue = 0;
      let revenueWithKnownCost = 0;
      let profit = 0;
      let shippingCost = 0;
      let shopeeFees = 0;
      let productCost = 0;
      let itemsMissingCost = 0;
      const profitByDay = new Map<string, number>();

      for (const order of orders) {
        const day = (order.completedAt ?? order.orderDate).toISOString().slice(0, 10);
        for (const li of order.lineItems) {
          const sale = Number(li.salePrice);
          revenue += sale;

          if (li.profit !== null) {
            revenueWithKnownCost += sale;
            profit += Number(li.profit);
            shippingCost += Number(li.shippingFeeAllocated);
            shopeeFees += Number(li.shopeeFeeAllocated);
            productCost += Number(li.productCostSnapshot ?? 0);
            profitByDay.set(day, (profitByDay.get(day) ?? 0) + Number(li.profit));
          } else {
            itemsMissingCost++;
          }
        }
      }

      const cost = shippingCost + shopeeFees + productCost;
      const ordersCount = orders.length;
      const avgTicket = ordersCount > 0 ? revenue / ordersCount : 0;
      const profitMargin = revenueWithKnownCost > 0 ? (profit / revenueWithKnownCost) * 100 : 0;
      const trend = Array.from(profitByDay.entries())
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, profit]) => ({ date, profit }));

      return {
        revenue,
        cost,
        shippingCost,
        shopeeFees,
        productCost,
        profit,
        ordersCount,
        avgTicket,
        profitMargin,
        itemsMissingCost,
        trend,
      };
    }
  );
}
