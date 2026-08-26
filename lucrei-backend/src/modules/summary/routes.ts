import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { rangeStart, type Period } from '../../lib/period';

export async function summaryRoutes(app: FastifyInstance) {
  app.get<{ Params: { shopId: string }; Querystring: { period?: Period } }>(
    '/shops/:shopId/summary',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const period = request.query.period ?? '30d';
      const start = rangeStart(period);

      const orders = await prisma.order.findMany({
        where: { shopId: shop.id, orderDate: { gte: start } },
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
        const day = order.orderDate.toISOString().slice(0, 10);
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
