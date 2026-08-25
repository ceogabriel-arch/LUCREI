import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { getValidAccessToken } from '../../lib/shopee-token';
import { getItemBaseInfo, getItemList } from '../../shopee-client';

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

  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/shopee-products',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await requireOwnedShop(request.user.sub, request.params.shopId);
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      try {
        const { accessToken, shopeeShopId } = await getValidAccessToken(shop.id);

        const itemIds: number[] = [];
        let offset = 0;
        let hasNext = true;
        while (hasNext && itemIds.length < 200) {
          const page = await getItemList(accessToken, shopeeShopId, { offset, pageSize: 50 });
          itemIds.push(...page.item.map((i) => i.item_id));
          hasNext = page.has_next_page;
          offset = page.next_offset;
        }

        const baseInfo = itemIds.length > 0 ? await getItemBaseInfo(accessToken, shopeeShopId, itemIds) : [];
        const costs = await prisma.product.findMany({ where: { shopId: shop.id } });
        const costByItemId = new Map(costs.map((c) => [c.shopeeItemId, c]));

        const products = baseInfo.map((item) => {
          const existing = costByItemId.get(String(item.item_id));
          return {
            shopeeItemId: String(item.item_id),
            name: item.item_name,
            image: item.image?.image_url_list?.[0] ?? null,
            price: item.price_info?.[0]?.current_price ?? null,
            costPrice: existing ? Number(existing.costPrice) : null,
          };
        });

        return { products };
      } catch (err) {
        app.log.error(err);
        return reply.status(502).send({ message: 'Falha ao buscar catálogo na Shopee.' });
      }
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
