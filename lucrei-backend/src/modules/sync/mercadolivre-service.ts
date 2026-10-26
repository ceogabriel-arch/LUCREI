import { mapLimit, withTimeout } from '../../lib/concurrency';
import { checkDailyGoalReached } from '../../lib/daily-goal-notifications';
import { notifyOrderCompletedIfNeeded } from '../../lib/order-notifications';
import { getValidAccessToken } from '../../lib/mercadolivre-token';
import { prisma } from '../../lib/prisma';
import { getOrder, getShipmentCosts, searchOrders } from '../../mercadolivre-client';
import { trackRecentMercadoLivreOrderEvent } from '../../lib/recent-order-events';
import { computeLineProfit } from './order-math';
import { allocateMLLineItem, computeMLOrderTotals } from './mercadolivre-order-math';

// "paid" é o status "resolvido com sucesso" (equivalente ao COMPLETED da
// Shopee) - confirmado contra 3 pedidos reais (venda, frete e sale_fee
// batendo exatos com a API) em 2026-10-02.
const ELIGIBLE_STATUSES = new Set(['paid']);

// Pedido comprado mas ainda não em nenhum desses três estados finais conta
// como "em processamento" pra previsão de lucro do Início - mesmo papel que
// RESOLVED_STATUSES cumpre pro lado Shopee em order-forecast/routes.ts.
export const ML_RESOLVED_STATUSES = new Set(['paid', 'cancelled', 'invalid']);

// Pedido que já foi "paid" e depois virou um desses - mesmo papel do
// SHOPEE_CANCELLED_STATUSES em sync/service.ts: some do banco (deleteMany),
// não fica só com o status desatualizado contando como venda à toa. Achado
// ao vivo (26/10): diferente da Shopee, isso nunca era tratado - um pedido
// cancelado depois de pago continuava contando pra sempre no total de
// vendas/lucro.
export const ML_CANCELLED_STATUSES = new Set(['cancelled', 'invalid']);

// Usado pelo webhook (Fase 2 em tempo real) - mesmo papel do syncOneOrder da
// Shopee: sincroniza UM pedido específico sem varrer a loja inteira.
export async function syncOneMercadoLivreOrder(shopId: string, orderId: number) {
  const { accessToken } = await getValidAccessToken(shopId);
  return processOrder(shopId, accessToken, orderId);
}

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

  checkDailyGoalReached(shopDbId).catch(() => {});

  return { orderId: dbOrder.id, totalProfit };
}

const PAGE_SIZE = 50;
const MAX_PAGES = 400; // teto de segurança (até 20 mil pedidos), mesmo espírito do MAX_PAGES_PER_WINDOW da Shopee

// Achado ao vivo (19/10): sem janela nenhuma, o sync "do dia a dia" varria o
// histórico INTEIRO do vendedor toda vez (igual o backfill), um pedido de
// cada vez (sem paralelismo) - uma loja real de ~300 pedidos/mês já levava
// mais de 10 minutos por sincronização, e isso é só o que piora com o tempo
// (cada mês que passa, mais pedido histórico pra reprocessar à toa). Agora o
// sync normal usa uma janela de dias pra trás (igual WINDOW_SECONDS da
// Shopee), e só o backfill de histórico (acionado manualmente, uma vez)
// continua varrendo tudo sem janela.
export const REGULAR_SYNC_WINDOW_DAYS = 15;
const WINDOW_TIMEOUT_MS = 10 * 60 * 1000;

export async function syncOrdersSince(shopId: string, dateFrom: Date | null) {
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

    const page = await searchOrders(accessToken, String(mercadoLivreUserId), {
      offset,
      limit: PAGE_SIZE,
      dateFrom: dateFrom?.toISOString(),
    });
    total = page.paging?.total ?? page.results.length;
    ordersSeen += page.results.length;

    // Diferente da Shopee (que alimenta isso via push em tempo real), o
    // Mercado Livre ainda não tem webhook - é esse sync periódico que
    // precisa registrar TODO pedido visto (não só os já "paid"), senão a
    // previsão de lucro nunca saberia de um pedido ainda em processamento.
    await Promise.all(page.results.map((o) => trackRecentMercadoLivreOrderEvent(shopId, String(o.id), o.status)));

    // Pedido que já tinha sido sincronizado como "paid" e virou cancelado/
    // inválido desde então - remove do banco em vez de deixar contando como
    // venda à toa (mesmo tratamento que a Shopee já faz).
    const cancelledIds = page.results.filter((o) => ML_CANCELLED_STATUSES.has(o.status)).map((o) => String(o.id));
    if (cancelledIds.length > 0) {
      await prisma.order.deleteMany({ where: { shopId, mercadoLivreOrderId: { in: cancelledIds } } });
    }

    // Mesmo paralelismo da Shopee (lá 15, aqui 10 - um pedido daqui pode
    // disparar 2 chamadas à API, não 1, então um teto um pouco mais
    // conservador pro rate limit do Mercado Livre).
    const eligible = page.results.filter((o) => ELIGIBLE_STATUSES.has(o.status));
    await mapLimit(eligible, 10, (o) => processOrder(shopId, accessToken, o.id));
    ordersSynced += eligible.length;

    if (page.results.length === 0) break;
    offset += PAGE_SIZE;
  }

  await prisma.shop.update({ where: { id: shopId }, data: { lastSyncedAt: new Date() } });
  return { ordersSeen, ordersSynced };
}

// Sync do dia a dia (botão "Sincronizar" e o watchdog) - só os últimos
// REGULAR_SYNC_WINDOW_DAYS dias, com teto de tempo (mesmo espírito do
// WINDOW_TIMEOUT_MS da Shopee, pra nunca ficar "rodando" pendurado sem fim).
export function syncShopOrders(shopId: string) {
  const dateFrom = new Date(Date.now() - REGULAR_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return withTimeout(
    syncOrdersSince(shopId, dateFrom),
    WINDOW_TIMEOUT_MS,
    `Sincronização demorou mais de ${WINDOW_TIMEOUT_MS / 60000} minuto(s) pra responder.`
  );
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

// Diferente do sync normal (agora com janela de REGULAR_SYNC_WINDOW_DAYS), o
// backfill de histórico continua varrendo TODO o histórico do vendedor, sem
// teto de tempo - é acionado manualmente, uma vez, e é esperado demorar pra
// loja antiga/grande.
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
    const result = await syncOrdersSince(shopId, null);
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
