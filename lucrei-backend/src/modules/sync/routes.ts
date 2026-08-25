import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
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
