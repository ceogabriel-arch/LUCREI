import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';

type UpsertProductBody = {
  shopeeItemId: string;
  name: string;
  costPrice: number;
};

async function requireOwnedShop(userId: string, shopId: string) {
  return prisma.shop.findFirst({ where: { id: shopId, userId } });
}

export async function productRoutes(app: FastifyInstance) {
  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/products',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await requireOwnedShop(request.user.sub, request.params.shopId);
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const products = await prisma.product.findMany({ where: { shopId: shop.id } });
      return { products };
    }
  );

  app.post<{ Params: { shopId: string }; Body: UpsertProductBody }>(
    '/shops/:shopId/products',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await requireOwnedShop(request.user.sub, request.params.shopId);
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const { shopeeItemId, name, costPrice } = request.body;
      if (!shopeeItemId || !name || costPrice == null) {
        return reply.status(400).send({ message: 'shopeeItemId, name e costPrice são obrigatórios.' });
      }

      const existing = await prisma.product.findFirst({ where: { shopId: shop.id, shopeeItemId } });

      const product = existing
        ? await prisma.product.update({
            where: { id: existing.id },
            data: { name, costPrice, costSource: 'manual' },
          })
        : await prisma.product.create({
            data: { shopId: shop.id, shopeeItemId, name, costPrice, costSource: 'manual' },
          });

      return product;
    }
  );
}
