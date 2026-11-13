import { checkDailyGoalReached } from '../../lib/daily-goal-notifications';
import { acknowledgeEvents, getMerchantEvents, getOrder, type IfoodEvent } from '../../ifood-client';
import { getValidAccessToken } from '../../lib/ifood-token';
import { notifyOrderCompletedIfNeeded } from '../../lib/order-notifications';
import { prisma } from '../../lib/prisma';
import { trackRecentIfoodOrderEvent } from '../../lib/recent-order-events';
import { allocateIfoodLineItem, computeIfoodOrderTotals } from './ifood-order-math';
import { computeLineProfit, computeTaxAllocated } from './order-math';

// Códigos de evento de polling ainda não confirmados contra a documentação
// de verdade (ver aviso em ifood-client/index.ts) - "CONCLUDED" é quando o
// pedido finaliza (equivalente ao COMPLETED da Shopee/"paid" do ML),
// "CANCELLED" é cancelamento. Qualquer outro código só alimenta o rastro de
// "pedido em processamento" (RecentOrderEvent), sem sincronizar de verdade.
const CONCLUDED_CODES = new Set(['CONCLUDED']);
const CANCELLED_CODES = new Set(['CANCELLED']);

// Usado por pending-orders.ts pra decidir o que ainda conta como "em
// processamento" - mesmo papel de ML_RESOLVED_STATUSES.
export const IFOOD_RESOLVED_STATUSES = new Set(['CONCLUDED', 'CANCELLED']);

export async function syncOneIfoodOrder(shopId: string, orderId: string) {
  const { accessToken } = await getValidAccessToken(shopId);
  return processOrder(shopId, accessToken, orderId);
}

async function processOrder(shopDbId: string, accessToken: string, orderId: string) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopDbId } });
  const order = await getOrder(accessToken, orderId);
  const items = order.items ?? [];

  const commissionPercent = shop.ifoodCommissionPercent != null ? Number(shop.ifoodCommissionPercent) : 0;
  const taxRatePercent = shop.taxRatePercent != null ? Number(shop.taxRatePercent) : 0;
  // Entrega feita pela própria iFood não custa nada ao lojista - só
  // descontaria quando a própria loja banca a entrega, caso ainda não
  // confirmado no payload (ver aviso no cliente) - 0 nunca superestima o
  // custo do lojista, só pode subestimar até isso ser confirmado.
  const deliveryFeeToSeller = 0;

  const totals = computeIfoodOrderTotals(items);
  const completedAt = order.createdAt ? new Date(order.createdAt) : new Date();

  const dbOrder = await prisma.order.upsert({
    where: { ifoodOrderId: orderId },
    update: { orderStatus: 'CONCLUDED', completedAt },
    create: {
      shopId: shopDbId,
      ifoodOrderId: orderId,
      orderStatus: 'CONCLUDED',
      orderDate: order.createdAt ? new Date(order.createdAt) : new Date(),
      completedAt,
      // NOT NULL no schema (compartilhado com a Shopee) - a iFood não tem
      // equivalente de "buyer_paid_shipping_fee" usado em cálculo nenhum.
      buyerPaidShippingFee: 0,
    },
  });

  const itemIds = items.map((it) => it.id);
  const existingProducts = await prisma.product.findMany({
    where: { shopId: shopDbId, ifoodItemId: { in: itemIds } },
  });
  const productByItemId = new Map(existingProducts.map((p) => [p.ifoodItemId!, p]));

  // Sem API de catálogo confirmada pra iFood - produto é criado sob demanda
  // a partir do próprio item do pedido, custo manual (0) até o lojista
  // preencher na tela de Produtos, igual já acontece hoje pra item sem
  // importação.
  for (const it of items) {
    if (!productByItemId.has(it.id)) {
      const created = await prisma.product.create({
        data: { shopId: shopDbId, ifoodItemId: it.id, name: it.name, costPrice: 0, costSource: 'manual' },
      });
      productByItemId.set(it.id, created);
    }
  }

  let profitSum = 0;
  let itemsMissingCost = 0;

  const lineItemsData = items.map((it) => {
    const { lineValue, feeAllocated, shippingFeeAllocated } = allocateIfoodLineItem(
      it,
      totals,
      commissionPercent,
      deliveryFeeToSeller
    );
    const product = productByItemId.get(it.id);
    const taxAllocated = computeTaxAllocated(lineValue, taxRatePercent);

    const productCostSnapshot = product ? Number(product.costPrice) * it.quantity : null;
    const profit = computeLineProfit(lineValue, shippingFeeAllocated, feeAllocated, productCostSnapshot, taxAllocated);

    if (profit === null) itemsMissingCost++;
    else profitSum += profit;

    return {
      orderId: dbOrder.id,
      productId: product?.id,
      ifoodItemId: it.id,
      itemName: it.name,
      quantity: it.quantity,
      salePrice: lineValue,
      shippingFeeAllocated,
      shopeeFeeAllocated: feeAllocated,
      taxAllocated,
      productCostSnapshot: productCostSnapshot ?? undefined,
      profit: profit ?? undefined,
    };
  });

  // Mesmo lock por linha que Shopee/ML usam - sync e um possível reprocesso
  // do mesmo evento podem rodar juntos pro mesmo pedido.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${dbOrder.id} FOR UPDATE`;
    await tx.orderLineItem.deleteMany({ where: { orderId: dbOrder.id } });
    await tx.orderLineItem.createMany({ data: lineItemsData });
  });

  const totalProfit = itemsMissingCost === items.length ? null : profitSum;
  const totalRevenue = lineItemsData.reduce((sum, li) => sum + li.salePrice, 0);

  await notifyOrderCompletedIfNeeded({
    orderId: dbOrder.id,
    orderSn: orderId,
    shopDbId,
    completedAt: dbOrder.completedAt,
    totalProfit,
    totalRevenue,
  }).catch(() => {});

  checkDailyGoalReached(shopDbId).catch(() => {});

  return { orderId: dbOrder.id, totalProfit };
}

// Único jeito de saber de pedido novo - a iFood não empurra nada, precisa
// consultar o endpoint de eventos periodicamente e confirmar cada um (senão
// reaparece na próxima consulta). Chamado pelo watchdog dedicado (ver
// ifood-poll-watchdog.ts) e também é o que runShopSync usa como "sincronizar
// agora" manual, já que não há endpoint de busca por período confirmado.
export async function pollShopEvents(shopId: string): Promise<{ eventsProcessed: number }> {
  const { accessToken, merchantId } = await getValidAccessToken(shopId);
  const events: IfoodEvent[] = await getMerchantEvents(accessToken, merchantId);
  if (events.length === 0) return { eventsProcessed: 0 };

  for (const event of events) {
    await trackRecentIfoodOrderEvent(shopId, event.orderId, event.code);

    if (CONCLUDED_CODES.has(event.code)) {
      await processOrder(shopId, accessToken, event.orderId).catch(() => {
        // Loja fica sem esse pedido processado até o próximo polling tentar
        // de novo - não deixa um pedido com erro travar os outros do lote.
      });
    } else if (CANCELLED_CODES.has(event.code)) {
      await prisma.order.deleteMany({ where: { shopId, ifoodOrderId: event.orderId } });
    }
  }

  await acknowledgeEvents(accessToken, events.map((e) => e.id));
  return { eventsProcessed: events.length };
}

export async function runShopSync(shopId: string) {
  await prisma.shop.update({
    where: { id: shopId },
    data: { syncStatus: 'running', syncStartedAt: new Date(), syncOrdersSynced: null, syncError: null },
  });

  try {
    const result = await pollShopEvents(shopId);
    await prisma.shop.update({
      where: { id: shopId },
      data: { syncStatus: 'done', syncOrdersSynced: result.eventsProcessed, lastSyncedAt: new Date() },
    });
  } catch (err) {
    await prisma.shop.update({
      where: { id: shopId },
      data: { syncStatus: 'error', syncError: err instanceof Error ? err.message : 'Erro desconhecido.' },
    });
  }
}

// Sem endpoint de histórico/backfill confirmado pra iFood ainda - o botão de
// backfill do app chama isso, mas hoje só repete o polling normal (eventos
// de pedidos antigos já devem ter sido consumidos ou vencido do lado da
// iFood). Ajustar assim que um endpoint de busca por período for confirmado.
export async function runHistoryBackfill(shopId: string) {
  await prisma.shop.update({
    where: { id: shopId },
    data: { historyBackfillStatus: 'running', historyBackfillStartedAt: new Date(), historyBackfillError: null },
  });

  try {
    const result = await pollShopEvents(shopId);
    await prisma.shop.update({
      where: { id: shopId },
      data: { historyBackfillStatus: 'done', historyBackfillDoneAt: new Date(), historyBackfillSynced: result.eventsProcessed },
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
