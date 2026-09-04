import type { FastifyInstance } from 'fastify';

import { mapLimit } from '../../lib/concurrency';
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

type CatalogItem = {
  shopeeItemId: string;
  name: string;
  image: string | null;
  price: number | null;
};

const CATALOG_TTL_MS = 5 * 60 * 1000;
const catalogCache = new Map<string, { expiresAt: number; items: CatalogItem[] }>();

// O catálogo (nome/imagem/preço) não depende do período selecionado no app,
// então cacheamos por loja - trocar de "Hoje" pra "30 dias" não deveria
// refazer a mesma cadeia de chamadas à Shopee.
async function getShopeeCatalog(shopDbId: string, accessToken: string, shopeeShopId: number): Promise<CatalogItem[]> {
  const cached = catalogCache.get(shopDbId);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  const pageSize = 50;
  const maxItems = 200;

  const firstPage = await getItemList(accessToken, shopeeShopId, { offset: 0, pageSize });
  const itemIds = firstPage.item.map((i) => i.item_id);
  const totalToFetch = Math.min(firstPage.total_count, maxItems);

  const remainingOffsets: number[] = [];
  for (let offset = pageSize; offset < totalToFetch; offset += pageSize) remainingOffsets.push(offset);

  if (remainingOffsets.length > 0) {
    const pages = await Promise.all(
      remainingOffsets.map((offset) => getItemList(accessToken, shopeeShopId, { offset, pageSize }))
    );
    for (const page of pages) itemIds.push(...page.item.map((i) => i.item_id));
  }

  const limitedItemIds = itemIds.slice(0, maxItems);

  // get_item_base_info só aceita até 50 itens por chamada; os lotes são
  // independentes, então rodam em paralelo em vez de um atrás do outro.
  const batches: number[][] = [];
  for (let i = 0; i < limitedItemIds.length; i += 50) batches.push(limitedItemIds.slice(i, i + 50));
  const baseInfoBatches = await Promise.all(batches.map((batch) => getItemBaseInfo(accessToken, shopeeShopId, batch)));
  const baseInfo = baseInfoBatches.flat();

  // get_model_list é uma chamada por produto; limitamos a concorrência pra
  // não estourar o rate limit da Shopee em lojas com muita variação.
  const items = await mapLimit(baseInfo, 10, async (item): Promise<CatalogItem> => {
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

    return {
      shopeeItemId: String(item.item_id),
      name: item.item_name,
      image: item.image?.image_url_list?.[0] ?? null,
      price,
    };
  });

  catalogCache.set(shopDbId, { expiresAt: Date.now() + CATALOG_TTL_MS, items });
  return items;
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
        const catalog = await getShopeeCatalog(shop.id, accessToken, shopeeShopId);

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

        const products = catalog.map((item) => {
          const existing = costByItemId.get(item.shopeeItemId);
          const stat = statsByItemId.get(item.shopeeItemId);

          return {
            shopeeItemId: item.shopeeItemId,
            name: item.name,
            image: item.image,
            price: item.price,
            costPrice: existing ? Number(existing.costPrice) : null,
            profit: stat ? stat.profit : null,
            revenue: stat ? stat.revenue : null,
            orders: stat ? stat.orders : 0,
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

      const products = await prisma.$transaction(
        async (tx) => {
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
        },
        // O padrão do Prisma (5s) estoura fácil com dezenas de produtos, cada um
        // podendo atualizar vários line items de pedidos junto.
        { timeout: 60_000, maxWait: 15_000 }
      );

      return { products };
    }
  );
}
