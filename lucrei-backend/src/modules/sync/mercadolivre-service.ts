import { notifyOrderCompletedIfNeeded } from '../../lib/order-notifications';
import { getValidAccessToken } from '../../lib/mercadolivre-token';
import { prisma } from '../../lib/prisma';
import { getOrder, getShipmentCosts, searchOrders } from '../../mercadolivre-client';
import { computeLineProfit } from './order-math';
import { allocateMLLineItem, computeMLOrderTotals } from './mercadolivre-order-math';

// "paid" é o mais próximo do COMPLETED da Shopee que dá pra pedir direto no
// filtro de busca do Mercado Livre - ainda não confirmado contra devolução/
// cancelamento pós-pagamento com um pedido real de verdade (mesma ressalva
// do mercadolivre-client sobre sale_fee). Revisar assim que uma loja real
// passar por isso.
const ELIGIBLE_STATUSES = new Set(['paid']);

async function processOrder(shopDbId: string, accessToken: string, orderId: number) {
  const order = await getOrder(accessToken, orderId);
  const items = order.order_items ?? [];

  // Frete que sai do bolso do vendedor é por PEDIDO (via shipment), não por
  // item - uma chamada extra só quando o pedido tem envio vinculado. Loja
  // sem Mercado Envios (combinado fora da plataforma) não tem shipment.id -
  // sem custo de frete nesse caso, não dá pra travar o pedido inteiro por
  // isso.
  let shippingCost = 0;
  if (order.shipping?.id) {
    try {
      const costs = await getShipmentCosts(accessToken, order.shipping.id);
      shippingCost = (costs.senders ?? []).reduce((sum, s) => sum + s.cost, 0);
    } catch {
      shippingCost = 0;
    }
  }

  const totals = computeMLOrderTotals(items);
  const completedAt = order.date_closed ? new Date(order.date_closed) : new Date();

  const dbOrder = await prisma.order.upsert({
    where: { mercadoLivreOrderId: String(orderId) },
    update: {
      orderStatus: order.status ?? 'unknown',
      completedAt,
      escrowSyncedAt: new Date(),
    },
    create: {
      shopId: shopDbId,
      mercadoLivreOrderId: String(orderId),
      orderStatus: order.status ?? 'unknown',
      orderDate: order.date_created ? new Date(order.date_created) : new Date(),
      completedAt,
      // Sem equivalente direto do "buyer_paid_shipping_fee" da Shopee nesse
      // endpoint - não é usado em cálculo nenhum pro Mercado Livre hoje, só
      // existe na coluna porque é NOT NULL no schema (compartilhado com a
      // Shopee).
      buyerPaidShippingFee: 0,
      escrowSyncedAt: new Date(),
    },
  });

  const itemIds = items.map((li) => li.item.id);
  const products = await prisma.product.findMany({
    where: { shopId: shopDbId, mercadoLivreItemId: { in: itemIds } },
  });
  const productByItemId = new Map<string, (typeof products)[number]>();
  for (const p of products) {
    if (p.mercadoLivreItemId && !productByItemId.has(p.mercadoLivreItemId)) productByItemId.set(p.mercadoLivreItemId, p);
  }

  let profitSum = 0;
  let itemsMissingCost = 0;

  const lineItemsData = items.map((li) => {
    const { lineValue, feeAllocated, shippingFeeAllocated } = allocateMLLineItem(li, totals, shippingCost);
    const product = productByItemId.get(li.item.id);

    const productCostSnapshot = product ? Number(product.costPrice) * li.quantity : null;
    const profit = computeLineProfit(lineValue, shippingFeeAllocated, feeAllocated, productCostSnapshot);

    if (profit === null) itemsMissingCost++;
    else profitSum += profit;

    return {
      orderId: dbOrder.id,
      productId: product?.id,
      mercadoLivreItemId: li.item.id,
      itemName: li.item.title,
      quantity: li.quantity,
      salePrice: lineValue,
      shippingFeeAllocated,
      // Campo chama "shopeeFeeAllocated" no schema (criado antes da Fase 2
      // existir) mas é só "taxa do marketplace alocada" - genérico o
      // bastante pra reaproveitar aqui sem precisar de coluna nova.
      shopeeFeeAllocated: feeAllocated,
      productCostSnapshot: productCostSnapshot ?? undefined,
      profit: profit ?? undefined,
    };
  });

  // Mesmo lock por linha que a Shopee usa - sync normal e backfill podem
  // rodar juntos pro mesmo pedido.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${dbOrder.id} FOR UPDATE`;
    await tx.orderLineItem.deleteMany({ where: { orderId: dbOrder.id } });
    await tx.orderLineItem.createMany({ data: lineItemsData });
  });

  const totalProfit = itemsMissingCost === items.length ? null : profitSum;
  const totalRevenue = lineItemsData.reduce((sum, li) => sum + li.salePrice, 0);

  await notifyOrderCompletedIfNeeded({
    orderId: dbOrder.id,
    orderSn: String(orderId),
    shopDbId,
    completedAt: dbOrder.completedAt,
    totalProfit,
    totalRevenue,
  }).catch(() => {});

  return { orderId: dbOrder.id, totalProfit };
}

// Diferente da Shopee, a busca de pedidos do Mercado Livre não tem limite de
// 15 dias por chamada - só pagina (offset/limit) o histórico inteiro do
// vendedor. Por isso sync do dia a dia e backfill de histórico podem ser a
// MESMA função aqui: não existe "janela" pra varrer em blocos.
const PAGE_SIZE = 50;
const MAX_PAGES = 400; // teto de segurança (até 20 mil pedidos), mesmo espírito do MAX_PAGES_PER_WINDOW da Shopee

export async function syncShopOrders(shopId: string) {
  const { accessToken, mercadoLivreUserId } = await getValidAccessToken(shopId);

  let offset = 0;
  let total = Infinity;
  let ordersSeen = 0;
  let ordersSynced = 0;
  let pages = 0;

  while (offset < total) {
    pages++;
    if (pages > MAX_PAGES) {
      throw new Error(`Mais de ${MAX_PAGES} páginas de pedidos - parando por segurança.`);
    }

    const page = await searchOrders(accessToken, String(mercadoLivreUserId), { offset, limit: PAGE_SIZE });
    total = page.paging?.total ?? page.results.length;
    ordersSeen += page.results.length;

    const eligible = page.results.filter((o) => ELIGIBLE_STATUSES.has(o.status));
    for (const o of eligible) {
      await processOrder(shopId, accessToken, o.id);
      ordersSynced++;
    }

    if (page.results.length === 0) break;
    offset += PAGE_SIZE;
  }

  await prisma.shop.update({ where: { id: shopId }, data: { lastSyncedAt: new Date() } });
  return { ordersSeen, ordersSynced };
}

export async function runShopSync(shopId: string) {
  await prisma.shop.update({
    where: { id: shopId },
    data: { syncStatus: 'running', syncStartedAt: new Date(), syncOrdersSynced: null, syncError: null },
  });

  try {
    const result = await syncShopOrders(shopId);
    await prisma.shop.update({
      where: { id: shopId },
      data: { syncStatus: 'done', syncOrdersSynced: result.ordersSynced },
    });
  } catch (err) {
    await prisma.shop.update({
      where: { id: shopId },
      data: { syncStatus: 'error', syncError: err instanceof Error ? err.message : 'Erro desconhecido.' },
    });
  }
}

// Histórico completo já é trazido pelo sync normal (sem janela de 15 dias
// pra varrer) - o backfill do Mercado Livre é só um alias, existe pra bater
// com a mesma rota genérica (/shops/:shopId/backfill) que a Shopee usa.
export async function runHistoryBackfill(shopId: string) {
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      historyBackfillStatus: 'running',
      historyBackfillStartedAt: new Date(),
      historyBackfillDoneAt: null,
      historyBackfillSynced: 0,
      historyBackfillWindowsDone: 0,
      historyBackfillError: null,
    },
  });

  try {
    const result = await syncShopOrders(shopId);
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        historyBackfillStatus: 'done',
        historyBackfillDoneAt: new Date(),
        historyBackfillSynced: result.ordersSynced,
        historyBackfillWindowsDone: 1,
      },
    });
  } catch (err) {
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        historyBackfillStatus: 'error',
        historyBackfillDoneAt: new Date(),
        historyBackfillError: err instanceof Error ? err.message : 'Erro desconhecido.',
      },
    });
  }
}
