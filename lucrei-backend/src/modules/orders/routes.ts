import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { rangeStart, type Period } from '../../lib/period';

export async function orderRoutes(app: FastifyInstance) {
  app.get<{ Params: { shopId: string }; Querystring: { period?: Period } }>(
    '/shops/:shopId/orders',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const period = request.query.period ?? '30d';

      const orders = await prisma.order.findMany({
        where: { shopId: shop.id, orderDate: { gte: rangeStart(period) } },
        include: { lineItems: { include: { product: true } } },
        orderBy: { orderDate: 'desc' },
      });

      return {
        orders: orders.map((order) => {
          let revenue = 0;
          let profit = 0;
          let itemsMissingCost = 0;

          for (const li of order.lineItems) {
            revenue += Number(li.salePrice);
            if (li.profit !== null) {
              profit += Number(li.profit);
            } else {
              itemsMissingCost++;
            }
          }

          return {
            id: order.id,
            shopeeOrderSn: order.shopeeOrderSn,
            orderStatus: order.orderStatus,
            orderDate: order.orderDate,
            revenue,
            profit: itemsMissingCost === order.lineItems.length ? null : profit,
            itemsMissingCost,
            lineItems: order.lineItems.map((li) => ({
              id: li.id,
              productName: li.product?.name ?? `Item ${li.shopeeItemId ?? '?'}`,
              quantity: li.quantity,
              salePrice: Number(li.salePrice),
              shippingFeeAllocated: Number(li.shippingFeeAllocated),
              shopeeFeeAllocated: Number(li.shopeeFeeAllocated),
              productCostSnapshot: li.productCostSnapshot !== null ? Number(li.productCostSnapshot) : null,
              profit: li.profit !== null ? Number(li.profit) : null,
            })),
          };
        }),
      };
    }
  );
}
