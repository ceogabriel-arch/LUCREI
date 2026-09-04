import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { rangeStart, type Period } from '../../lib/period';
import { getValidAccessToken } from '../../lib/shopee-token';
import { getItemBaseInfo, getItemList, getModelList } from '../../shopee-client';

type UpsertProductBody = {
  shopeeItemId: string;
  name: string;
  costPrice: number;
};

type BatchUpsertProductBody = {
  items: UpsertProductBody[];
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

  app.get<{ Params: { shopId: string }; Querystring: { period?: Period } }>(
    '/shops/:shopId/shopee-products',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await requireOwnedShop(request.user.sub, request.params.shopId);
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const period = request.query.period ?? '30d';

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

        // get_item_base_info só aceita até 50 itens por chamada.
        const baseInfo = [];
        for (let i = 0; i < itemIds.length; i += 50) {
          const batch = itemIds.slice(i, i + 50);
          baseInfo.push(...(await getItemBaseInfo(accessToken, shopeeShopId, batch)));
        }
        const costs = await prisma.product.findMany({ where: { shopId: shop.id } });
        const costByItemId = new Map(costs.map((c) => [c.shopeeItemId, c]));

        const lineItems = await prisma.orderLineItem.findMany({
          where: { order: { shopId: shop.id, orderDate: { gte: rangeStart(period) } } },
        });
        const statsByItemId = new Map<string, { profit: number; revenue: number; orders: number }>();
        for (const li of lineItems) {
          if (!li.shopeeItemId) continue;
          const stat = statsByItemId.get(li.shopeeItemId) ?? { profit: 0, revenue: 0, orders: 0 };
          stat.revenue += Number(li.salePrice);
          stat.orders += 1;
          if (li.profit !== null) stat.profit += Number(li.profit);
          statsByItemId.set(li.shopeeItemId, stat);
        }

        const products = await Promise.all(
          baseInfo.map(async (item) => {
            const existing = costByItemId.get(String(item.item_id));
            let price = item.price_info?.[0]?.current_price ?? null;

            if (price === null && item.has_model) {
              try {
                const models = await getModelList(accessToken, shopeeShopId, item.item_id);
                const prices = models.map((m) => m.price_info[0]?.current_price).filter((p): p is number => p != null);
                price = prices.length > 0 ? Math.min(...prices) : null;
              } catch {
                price = null;
              }
            }

            const stat = statsByItemId.get(String(item.item_id));

            return {
              shopeeItemId: String(item.item_id),
              name: item.item_name,
              image: item.image?.image_url_list?.[0] ?? null,
              price,
              costPrice: existing ? Number(existing.costPrice) : null,
              profit: stat ? stat.profit : null,
              revenue: stat ? stat.revenue : null,
              orders: stat ? stat.orders : 0,
            };
          })
        );

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

      const affectedLineItems = await prisma.orderLineItem.findMany({
        where: { shopeeItemId, order: { shopId: shop.id } },
      });

      for (const li of affectedLineItems) {
        const productCostSnapshot = costPrice * li.quantity;
        const profit =
          Number(li.salePrice) - Number(li.shippingFeeAllocated) - Number(li.shopeeFeeAllocated) - productCostSnapshot;
        await prisma.orderLineItem.update({
          where: { id: li.id },
          data: { productId: product.id, productCostSnapshot, profit },
        });
      }

      return product;
    }
  );

  app.post<{ Params: { shopId: string }; Body: BatchUpsertProductBody }>(
    '/shops/:shopId/products/batch',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await requireOwnedShop(request.user.sub, request.params.shopId);
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const { items } = request.body;
      if (!Array.isArray(items) || items.length === 0) {
        return reply.status(400).send({ message: 'items é obrigatório e não pode ser vazio.' });
      }
      for (const item of items) {
        if (!item.shopeeItemId || !item.name || item.costPrice == null) {
          return reply.status(400).send({ message: 'shopeeItemId, name e costPrice são obrigatórios em cada item.' });
        }
      }

      const shopeeItemIds = items.map((i) => i.shopeeItemId);

      const existingProducts = await prisma.product.findMany({
        where: { shopId: shop.id, shopeeItemId: { in: shopeeItemIds } },
      });
      const existingByItemId = new Map(existingProducts.map((p) => [p.shopeeItemId, p]));

      const affectedLineItems = await prisma.orderLineItem.findMany({
        where: { shopeeItemId: { in: shopeeItemIds }, order: { shopId: shop.id } },
      });
      const lineItemsByShopeeId = new Map<string, typeof affectedLineItems>();
      for (const li of affectedLineItems) {
        if (!li.shopeeItemId) continue;
        const list = lineItemsByShopeeId.get(li.shopeeItemId) ?? [];
        list.push(li);
        lineItemsByShopeeId.set(li.shopeeItemId, list);
      }

      const products = await prisma.$transaction(async (tx) => {
        const results = [];
        for (const item of items) {
          const existing = existingByItemId.get(item.shopeeItemId);
          const product = existing
            ? await tx.product.update({
                where: { id: existing.id },
                data: { name: item.name, costPrice: item.costPrice, costSource: 'manual' },
              })
            : await tx.product.create({
                data: {
                  shopId: shop.id,
                  shopeeItemId: item.shopeeItemId,
                  name: item.name,
                  costPrice: item.costPrice,
                  costSource: 'manual',
                },
              });
          results.push(product);

          for (const li of lineItemsByShopeeId.get(item.shopeeItemId) ?? []) {
            const productCostSnapshot = item.costPrice * li.quantity;
            const profit =
              Number(li.salePrice) - Number(li.shippingFeeAllocated) - Number(li.shopeeFeeAllocated) - productCostSnapshot;
            await tx.orderLineItem.update({
              where: { id: li.id },
              data: { productId: product.id, productCostSnapshot, profit },
            });
          }
        }
        return results;
      });

      return { products };
    }
  );
}
