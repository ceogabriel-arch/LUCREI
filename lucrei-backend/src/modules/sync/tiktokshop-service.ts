import { mapLimit, withTimeout } from '../../lib/concurrency';
import { checkDailyGoalReached } from '../../lib/daily-goal-notifications';
import { notifyOrderCompletedIfNeeded } from '../../lib/order-notifications';
import { prisma } from '../../lib/prisma';
import { trackRecentTiktokShopOrderEvent } from '../../lib/recent-order-events';
import { getValidAccessToken } from '../../lib/tiktokshop-token';
import { getOrder, getOrderStatementTransactions, searchOrders, type TiktokOrder } from '../../tiktokshop-client';
import { computeLineProfit, computeTaxAllocated } from './order-math';
import { allocateTiktokLineItem, computeTiktokOrderCosts, groupTiktokLineItems } from './tiktokshop-order-math';

// Status da API 202309 (não confirmados contra pedido real): UNPAID, ON_HOLD,
// AWAITING_SHIPMENT, PARTIALLY_SHIPPING, AWAITING_COLLECTION, IN_TRANSIT,
// DELIVERED, COMPLETED, CANCELLED. Mesmo critério atual da Shopee (ver
// isEligibleShopeeStatus em sync/service.ts) e do "paid" do Mercado Livre:
// conta como venda assim que é paga - só ficam de fora pedido ainda não pago
// (UNPAID; ON_HOLD é a janela de cancelamento logo após o pagamento) e
// cancelado.
const TIKTOKSHOP_NOT_YET_SALE_STATUSES = new Set(['UNPAID', 'ON_HOLD']);

// Mesmo papel de ML_CANCELLED_STATUSES: pedido que chegou a ser sincronizado
// e depois foi cancelado some do banco, não fica contando como venda.
export const TIKTOKSHOP_CANCELLED_STATUSES = new Set(['CANCELLED']);

// Usado por pending-orders.ts - igual a Shopee, "em processamento" agora é só
// o pedido que ainda nem virou venda (o resto já tem número real em Order).
export const TIKTOKSHOP_PENDING_STATUSES = TIKTOKSHOP_NOT_YET_SALE_STATUSES;

function isEligibleStatus(status: string) {
  return !TIKTOKSHOP_NOT_YET_SALE_STATUSES.has(status) && !TIKTOKSHOP_CANCELLED_STATUSES.has(status);
}

export async function syncOneTiktokShopOrder(shopId: string, orderId: string) {
  const { accessToken, shopCipher } = await getValidAccessToken(shopId);
  const order = await getOrder(accessToken, shopCipher, orderId);
  return processOrder(shopId, accessToken, shopCipher, order);
}

// A busca de pedidos já devolve o pedido completo (com line_items) - diferente
// do ML, não precisa de uma chamada de detalhe por pedido, só a do extrato
// financeiro.
async function processOrder(shopDbId: string, accessToken: string, shopCipher: string, order: TiktokOrder) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopDbId } });
  const taxRatePercent = shop.taxRatePercent != null ? Number(shop.taxRatePercent) : 0;
  const items = groupTiktokLineItems(order.line_items ?? []);

  // Extrato só existe depois do repasse - pedido recém-concluído costuma vir
  // sem nada, e uma falha aqui não pode travar o pedido inteiro (taxa 0 até
  // o próximo sync dentro da janela reprocessar).
  let costs = { totalFee: 0, shippingCost: 0 };
  try {
    costs = computeTiktokOrderCosts(await getOrderStatementTransactions(accessToken, shopCipher, order.id));
  } catch {
    costs = { totalFee: 0, shippingCost: 0 };
  }

  const totalItemValue = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
  // Timestamps da API vêm em segundos Unix. completedAt segue o mesmo
  // significado da Shopee: "desde quando esse número vale" (update_time da
  // última mudança), não necessariamente o momento da conclusão.
  const orderDate = order.create_time ? new Date(order.create_time * 1000) : new Date();
  const completedAt = order.update_time ? new Date(order.update_time * 1000) : new Date();

  const dbOrder = await prisma.order.upsert({
    where: { tiktokShopOrderId: order.id },
    update: { orderStatus: order.status, completedAt, escrowSyncedAt: new Date() },
    create: {
      shopId: shopDbId,
      tiktokShopOrderId: order.id,
      orderStatus: order.status,
      orderDate,
      completedAt,
      // NOT NULL no schema (compartilhado com a Shopee) - não é usado em
      // cálculo nenhum pro TikTok Shop.
      buyerPaidShippingFee: 0,
      escrowSyncedAt: new Date(),
    },
  });

  const itemIds = [...new Set(items.map((it) => it.productId))];
  const existingProducts = await prisma.product.findMany({
    where: { shopId: shopDbId, tiktokShopItemId: { in: itemIds } },
  });
  const productByItemId = new Map(existingProducts.map((p) => [p.tiktokShopItemId!, p]));

  // Sem tela de catálogo do TikTok Shop ainda - produto é criado sob demanda
  // a partir do próprio pedido (mesmo esquema da iFood), custo manual 0 até o
  // vendedor preencher em Produtos.
  for (const it of items) {
    if (!productByItemId.has(it.productId)) {
      const created = await prisma.product.create({
        data: { shopId: shopDbId, tiktokShopItemId: it.productId, name: it.name, costPrice: 0, costSource: 'manual' },
      });
      productByItemId.set(it.productId, created);
    }
  }

  let profitSum = 0;
  let itemsMissingCost = 0;

  const lineItemsData = items.map((it) => {
    const { lineValue, feeAllocated, shippingFeeAllocated } = allocateTiktokLineItem(it, totalItemValue, costs);
    const product = productByItemId.get(it.productId);
    const taxAllocated = computeTaxAllocated(lineValue, taxRatePercent);

    const productCostSnapshot = product ? Number(product.costPrice) * it.quantity : null;
    const profit = computeLineProfit(lineValue, shippingFeeAllocated, feeAllocated, productCostSnapshot, taxAllocated);

    if (profit === null) itemsMissingCost++;
    else profitSum += profit;

    return {
      orderId: dbOrder.id,
      productId: product?.id,
      tiktokShopItemId: it.productId,
      itemName: it.name,
      quantity: it.quantity,
      salePrice: lineValue,
      shippingFeeAllocated,
      // "shopeeFeeAllocated" = taxa do marketplace alocada (nome histórico,
      // ver comentário equivalente em mercadolivre-service.ts).
      shopeeFeeAllocated: feeAllocated,
      taxAllocated,
      productCostSnapshot: productCostSnapshot ?? undefined,
      profit: profit ?? undefined,
    };
  });

  // Mesmo lock por linha que Shopee/ML usam - sync normal e backfill podem
  // rodar juntos pro mesmo pedido.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${dbOrder.id} FOR UPDATE`;
    await tx.orderLineItem.deleteMany({ where: { orderId: dbOrder.id } });
    await tx.orderLineItem.createMany({ data: lineItemsData });
  });

  const totalProfit = items.length === 0 || itemsMissingCost === items.length ? null : profitSum;
  const totalRevenue = lineItemsData.reduce((sum, li) => sum + li.salePrice, 0);

  // Só em COMPLETED, pelo mesmo motivo da Shopee (ver sync/service.ts):
  // processOrder roda desde o pagamento, e a notificação "Pedido concluído"
  // é um latch único - dispararia cedo demais e nunca mais.
  if (order.status === 'COMPLETED') {
    await notifyOrderCompletedIfNeeded({
      orderId: dbOrder.id,
      orderSn: order.id,
      shopDbId,
      completedAt: dbOrder.completedAt,
      totalProfit,
      totalRevenue,
    }).catch(() => {});
  }

  checkDailyGoalReached(shopDbId).catch(() => {});

  return { orderId: dbOrder.id, totalProfit };
}

const PAGE_SIZE = 50;
const MAX_PAGES = 400; // teto de segurança (até 20 mil pedidos), mesmo valor do Mercado Livre

// Mesma janela do sync normal do Mercado Livre (ver REGULAR_SYNC_WINDOW_DAYS
// em mercadolivre-service.ts) - o backfill de histórico continua sem janela.
export const REGULAR_SYNC_WINDOW_DAYS = 15;
const WINDOW_TIMEOUT_MS = 10 * 60 * 1000;

export async function syncOrdersSince(shopId: string, dateFrom: Date | null) {
  const { accessToken, shopCipher } = await getValidAccessToken(shopId);

  let pageToken: string | undefined;
  let ordersSeen = 0;
  let ordersSynced = 0;
  let pages = 0;

  do {
    pages++;
    if (pages > MAX_PAGES) {
      throw new Error(`Mais de ${MAX_PAGES} páginas de pedidos - parando por segurança.`);
    }

    const page = await searchOrders(accessToken, shopCipher, {
      pageSize: PAGE_SIZE,
      pageToken,
      updateTimeGe: dateFrom ? Math.floor(dateFrom.getTime() / 1000) : undefined,
    });
    const orders = page.orders ?? [];
    ordersSeen += orders.length;

    // Sem webhook configurado - é esse sync periódico que precisa registrar
    // TODO pedido visto, senão a previsão de lucro nunca saberia de um pedido
    // ainda em processamento (mesmo motivo do Mercado Livre).
    await Promise.all(orders.map((o) => trackRecentTiktokShopOrderEvent(shopId, o.id, o.status)));

    const cancelledIds = orders.filter((o) => TIKTOKSHOP_CANCELLED_STATUSES.has(o.status)).map((o) => o.id);
    if (cancelledIds.length > 0) {
      await prisma.order.deleteMany({ where: { shopId, tiktokShopOrderId: { in: cancelledIds } } });
    }

    // Mesmo teto de paralelismo do Mercado Livre - aqui cada pedido também
    // dispara 1 chamada extra (extrato financeiro).
    const eligible = orders.filter((o) => isEligibleStatus(o.status));
    await mapLimit(eligible, 10, (o) => processOrder(shopId, accessToken, shopCipher, o));
    ordersSynced += eligible.length;

    if (orders.length === 0) break;
    pageToken = page.next_page_token || undefined;
  } while (pageToken);

  await prisma.shop.update({ where: { id: shopId }, data: { lastSyncedAt: new Date() } });
  return { ordersSeen, ordersSynced };
}

// Sync do dia a dia (botão "Sincronizar" e o watchdog) - só os últimos
// REGULAR_SYNC_WINDOW_DAYS dias, com teto de tempo.
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

// Igual ao Mercado Livre: backfill varre TODO o histórico, sem janela nem
// teto de tempo - acionado manualmente, uma vez.
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
