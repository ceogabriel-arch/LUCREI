import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';

import { mapLimit } from '../../lib/concurrency';
import { prisma } from '../../lib/prisma';
import { rangeStart, type Period } from '../../lib/period';
import { getValidAccessToken } from '../../lib/shopee-token';
import { getValidAccessToken as getValidMercadoLivreAccessToken } from '../../lib/mercadolivre-token';
import { getItemBaseInfo, getItemList, getModelList } from '../../shopee-client';
import { getItems, searchItems } from '../../mercadolivre-client';

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

type OrderLineItemForRecalc = {
  id: string;
  quantity: number;
  salePrice: Prisma.Decimal;
  shippingFeeAllocated: Prisma.Decimal;
  shopeeFeeAllocated: Prisma.Decimal;
};

// Recalcula custo/lucro de cada line item afetado por uma mudança de preço
// de custo e grava tudo num só UPDATE (via VALUES), em vez de um
// tx.orderLineItem.update() por linha - produto com histórico de centenas
// de pedidos fazia isso virar centenas de idas ao banco sequenciais, uma
// transação inteira presa esperando cada uma terminar.
async function bulkRecalcLineItems(
  tx: Pick<PrismaClient, '$executeRaw'>,
  productId: string,
  costPrice: number,
  lineItems: OrderLineItemForRecalc[]
) {
  if (lineItems.length === 0) return;

  const rows = lineItems.map((li) => {
    const productCostSnapshot = costPrice * li.quantity;
    const profit =
      Number(li.salePrice) - Number(li.shippingFeeAllocated) - Number(li.shopeeFeeAllocated) - productCostSnapshot;
    return Prisma.sql`(${li.id}::text, ${productCostSnapshot}::numeric, ${profit}::numeric)`;
  });

  await tx.$executeRaw`
    UPDATE "OrderLineItem" AS oli
    SET "productId" = ${productId}, "productCostSnapshot" = v.cost, "profit" = v.profit
    FROM (VALUES ${Prisma.join(rows)}) AS v(id, cost, profit)
    WHERE oli.id = v.id
  `;
}

type CatalogItem = {
  shopeeItemId: string;
  name: string;
  image: string | null;
  price: number | null;
};

// 15min em vez de 5: nome/imagem/preço de catálogo raramente muda de um
// minuto pro outro, e essa cadeia de chamadas à Shopee (item_list +
// item_base_info + get_model_list por item com variação) é a parte lenta de
// verdade de abrir Produtos - cache mais longo evita repetir isso a troco de
// nada sempre que o usuário troca de aba e volta. Quem quiser dado fresco de
// verdade usa o "puxar pra atualizar", que ignora esse cache (forceRefresh).
const CATALOG_TTL_MS = 15 * 60 * 1000;
const catalogCache = new Map<string, { expiresAt: number; items: CatalogItem[] }>();

// O catálogo (nome/imagem/preço) não depende do período selecionado no app,
// então cacheamos por loja - trocar de "Hoje" pra "30 dias" não deveria
// refazer a mesma cadeia de chamadas à Shopee.
async function getShopeeCatalog(
  shopDbId: string,
  accessToken: string,
  shopeeShopId: number,
  forceRefresh = false
): Promise<CatalogItem[]> {
  const cached = catalogCache.get(shopDbId);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.items;

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

// Espelha getShopeeCatalog acima (mesmo cache por shopDbId, mesmo formato de
// saída CatalogItem - "shopeeItemId" carrega o item id do Mercado Livre
// quando a loja é ML, decisão da Fase 2 pra reaproveitar o mesmo formato que
// o app já consome sem precisar de rota nova).
async function getMercadoLivreCatalog(
  shopDbId: string,
  accessToken: string,
  sellerId: string,
  forceRefresh = false
): Promise<CatalogItem[]> {
  const cached = catalogCache.get(shopDbId);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.items;

  const maxItems = 200;
  const ids: string[] = [];
  let scrollId: string | undefined;
  // search_type=scan (ver mercadolivre-client) - segue paginando enquanto
  // vier scrollId e ainda não bateu o teto de itens.
  while (ids.length < maxItems) {
    const page = await searchItems(accessToken, sellerId, { scrollId });
    if (page.results.length === 0) break;
    ids.push(...page.results);
    scrollId = page.scrollId;
    if (!scrollId) break;
  }
  const limitedIds = ids.slice(0, maxItems);

  // Multiget documentado com teto de 20 ids por chamada (diferente do
  // limite de 50 da Shopee) - lotes independentes, rodam em paralelo.
  const batches: string[][] = [];
  for (let i = 0; i < limitedIds.length; i += 20) batches.push(limitedIds.slice(i, i + 20));
  const itemBatches = await Promise.all(batches.map((batch) => getItems(accessToken, batch)));
  const itemDetails = itemBatches.flat();

  const items: CatalogItem[] = itemDetails.map((item) => ({
    shopeeItemId: item.id,
    name: item.title,
    image: item.thumbnail ?? null,
    price:
      item.variations && item.variations.length > 0
        ? Math.min(...item.variations.map((v) => v.price))
        : item.price,
  }));

  catalogCache.set(shopDbId, { expiresAt: Date.now() + CATALOG_TTL_MS, items });
  return items;
}

export async function productRoutes(app: FastifyInstance) {
  // Itens que aparecem em pedidos mas não batem com nenhum Product cadastrado
  // - normalmente porque o produto foi excluído do catálogo da Shopee depois
  // de já ter sido vendido, então nunca mais aparece na lista normal de
  // Produtos (que só busca o catálogo atual). Sem isso, esses pedidos ficam
  // "sem custo" pra sempre, sem nenhum jeito de corrigir.
  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/orphan-products',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await requireOwnedShop(request.user.sub, request.params.shopId);
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const grouped = await prisma.orderLineItem.groupBy({
        by: ['shopeeItemId'],
        where: { order: { shopId: shop.id }, productId: null, shopeeItemId: { not: null } },
        _count: { _all: true },
      });

      const orphans = await Promise.all(
        grouped.map(async (g) => {
          // itemName só existe em pedidos sincronizados depois dessa
          // mudança - pedidos antigos não têm, por isso o nome pode vir nulo
          // (o app mostra um campo pro usuário preencher manualmente nesse caso).
          const sample = await prisma.orderLineItem.findFirst({
            where: { order: { shopId: shop.id }, shopeeItemId: g.shopeeItemId },
            select: { itemName: true },
            orderBy: { id: 'desc' },
          });
          return {
            shopeeItemId: g.shopeeItemId!,
            name: sample?.itemName ?? null,
            ordersAffected: g._count._all,
          };
        })
      );

      orphans.sort((a, b) => b.ordersAffected - a.ordersAffected);
      return reply.send({ orphans });
    }
  );

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

  app.get<{ Params: { shopId: string }; Querystring: { period?: Period; force?: string } }>(
    '/shops/:shopId/shopee-products',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await requireOwnedShop(request.user.sub, request.params.shopId);
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const period = request.query.period ?? '30d';
      const forceRefresh = request.query.force === 'true';
      const isMercadoLivre = shop.provider === 'mercado_livre';

      try {
        const catalog = isMercadoLivre
          ? await (async () => {
              const { accessToken, mercadoLivreUserId } = await getValidMercadoLivreAccessToken(shop.id);
              return getMercadoLivreCatalog(shop.id, accessToken, String(mercadoLivreUserId), forceRefresh);
            })()
          : await (async () => {
              const { accessToken, shopeeShopId } = await getValidAccessToken(shop.id);
              return getShopeeCatalog(shop.id, accessToken, shopeeShopId, forceRefresh);
            })();

        const costs = await prisma.product.findMany({ where: { shopId: shop.id } });
        const costByItemId = new Map(costs.map((c) => [isMercadoLivre ? c.mercadoLivreItemId : c.shopeeItemId, c]));

        const lineItems = await prisma.orderLineItem.findMany({
          where: { order: { shopId: shop.id, completedAt: { gte: rangeStart(period) } } },
        });
        const statsByItemId = new Map<string, { profit: number; revenue: number; orders: number }>();
        for (const li of lineItems) {
          const itemId = isMercadoLivre ? li.mercadoLivreItemId : li.shopeeItemId;
          if (!itemId) continue;
          const stat = statsByItemId.get(itemId) ?? { profit: 0, revenue: 0, orders: 0 };
          stat.revenue += Number(li.salePrice);
          stat.orders += 1;
          if (li.profit !== null) stat.profit += Number(li.profit);
          statsByItemId.set(itemId, stat);
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
        return reply
          .status(502)
          .send({ message: `Falha ao buscar catálogo ${isMercadoLivre ? 'no Mercado Livre' : 'na Shopee'}.` });
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

      // O campo na requisição continua se chamando "shopeeItemId" pros dois
      // marketplaces (decisão da Fase 2 do Mercado Livre - evita mexer no
      // app pra renomear), mas o valor é gravado na coluna certa conforme o
      // provider da loja, pra nunca confundir os dois espaços de ID.
      const itemIdFilter = shop.provider === 'mercado_livre' ? { mercadoLivreItemId: shopeeItemId } : { shopeeItemId };

      const existing = await prisma.product.findFirst({ where: { shopId: shop.id, ...itemIdFilter } });

      const product = existing
        ? await prisma.product.update({
            where: { id: existing.id },
            data: { name, costPrice, costSource: 'manual' },
          })
        : await prisma.product.create({
            data: { shopId: shop.id, name, costPrice, costSource: 'manual', ...itemIdFilter },
          });

      const affectedLineItems = await prisma.orderLineItem.findMany({
        where: { order: { shopId: shop.id }, ...itemIdFilter },
      });

      await bulkRecalcLineItems(prisma, product.id, costPrice, affectedLineItems);

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
      const isMercadoLivre = shop.provider === 'mercado_livre';

      const existingProducts = await prisma.product.findMany({
        where: {
          shopId: shop.id,
          ...(isMercadoLivre ? { mercadoLivreItemId: { in: shopeeItemIds } } : { shopeeItemId: { in: shopeeItemIds } }),
        },
      });
      const existingByItemId = new Map(
        existingProducts.map((p) => [isMercadoLivre ? p.mercadoLivreItemId : p.shopeeItemId, p])
      );

      const affectedLineItems = await prisma.orderLineItem.findMany({
        where: {
          order: { shopId: shop.id },
          ...(isMercadoLivre ? { mercadoLivreItemId: { in: shopeeItemIds } } : { shopeeItemId: { in: shopeeItemIds } }),
        },
      });
      const lineItemsByShopeeId = new Map<string, typeof affectedLineItems>();
      for (const li of affectedLineItems) {
        const itemId = isMercadoLivre ? li.mercadoLivreItemId : li.shopeeItemId;
        if (!itemId) continue;
        const list = lineItemsByShopeeId.get(itemId) ?? [];
        list.push(li);
        lineItemsByShopeeId.set(itemId, list);
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
                    name: item.name,
                    costPrice: item.costPrice,
                    costSource: 'manual',
                    ...(isMercadoLivre ? { mercadoLivreItemId: item.shopeeItemId } : { shopeeItemId: item.shopeeItemId }),
                  },
                });
            results.push(product);

            await bulkRecalcLineItems(tx, product.id, item.costPrice, lineItemsByShopeeId.get(item.shopeeItemId) ?? []);
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
