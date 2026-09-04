import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { startOfCurrentMonth } from '../../lib/period';
import { syncShopOrders } from './service';

export async function syncRoutes(app: FastifyInstance) {
  app.post<{ Params: { shopId: string } }>(
    '/shops/:shopId/sync',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) {
        return reply.status(404).send({ message: 'Loja não encontrada.' });
      }

      const user = await prisma.user.findUnique({
        where: { id: request.user.sub },
        include: { plan: true },
      });

      if (user?.plan?.salesLimit != null) {
        // "Vendas/mês" é por conta, não por loja - soma pedidos de todas as
        // lojas do usuário nesse mês.
        const ordersThisMonth = await prisma.order.count({
          where: { shop: { userId: request.user.sub }, orderDate: { gte: startOfCurrentMonth() } },
        });
        if (ordersThisMonth >= user.plan.salesLimit) {
          return reply.status(403).send({
            message: `Seu plano ${user.plan.name} permite até ${user.plan.salesLimit} vendas/mês e você já atingiu esse limite. Faça upgrade pra continuar sincronizando pedidos.`,
            code: 'sales_limit_reached',
          });
        }
      }

      try {
        const result = await syncShopOrders(shop.id);
        return result;
      } catch (err) {
        app.log.error(err);
        return reply.status(502).send({ message: 'Falha ao sincronizar pedidos com a Shopee.' });
      }
    }
  );
}
