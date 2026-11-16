import { checkDailyGoalReached } from '../../lib/daily-goal-notifications';
import { acknowledgeEvents, getMerchantEvents, getOrder, type IfoodEvent } from '../../ifood-client';
import { getValidAccessToken, IFOOD_RECONNECT_MESSAGE } from '../../lib/ifood-token';

export { IFOOD_RECONNECT_MESSAGE };
import { notifyOrderCompletedIfNeeded } from '../../lib/order-notifications';
import { prisma } from '../../lib/prisma';
import { trackRecentIfoodOrderEvent } from '../../lib/recent-order-events';
import { allocateIfoodLineItem, computeIfoodOrderTotals } from './ifood-order-math';
import { computeLineProfit, computeTaxAllocated } from './order-math';

// Confirmado com pedido de teste real (14/11/2026): o evento traz a sigla em
// "code" (PLC, CFM, CON, CAN, DDCR...) e o nome completo em "fullCode"
// (PLACED, CONFIRMED, CONCLUDED, CANCELLED...). Comparar "code" com o nome
// completo nunca batia - nenhum pedido era processado. "CONCLUDED" é quando
// o pedido finaliza (equivalente ao COMPLETED da Shopee/"paid" do ML).
const CONCLUDED_CODES = new Set(['CONCLUDED']);
const CANCELLED_CODES = new Set(['CANCELLED']);

// Só esses viram status do pedido no rastro de "em processamento" - a iFood
// também manda eventos que não são status (ex.: DDCR, pedido de código de
// entrega), que sobrescreveriam o status com algo que o app não conhece.
const ORDER_STATUS_CODES = new Set([
  'PLACED',
  'CONFIRMED',
  'SEPARATION_STARTED',
  'SEPARATION_ENDED',
  'READY_TO_PICKUP',
  'DISPATCHED',
  'CONCLUDED',
  'CANCELLED',
]);

function eventStatus(event: IfoodEvent) {
  return event.fullCode ?? event.code;
}

// Usado por pending-orders.ts pra decidir o que ainda conta como "em
// processamento" - mesmo papel de ML_RESOLVED_STATUSES.
export const IFOOD_RESOLVED_STATUSES = new Set(['CONCLUDED', 'CANCELLED']);

export async function syncOneIfoodOrder(shopId: string, orderId: string) {
  const { accessToken } = await getValidAccessToken(shopId);
  return processOrder(shopId, accessToken, orderId);
}

// concludedAt: hora do evento CONCLUDED - a hora de criação do pedido punha
// um pedido das 23:50 concluído às 00:30 no dia anterior.
async function processOrder(shopDbId: string, accessToken: string, orderId: string, concludedAt?: Date) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopDbId } });
  const order = await getOrder(accessToken, orderId);
  const items = order.items ?? [];

  const commissionPercent = shop.ifoodCommissionPercent != null ? Number(shop.ifoodCommissionPercent) : 0;
  const taxRatePercent = shop.taxRatePercent != null ? Number(shop.taxRatePercent) : 0;
  // Plano Entrega (iFood entrega) = sem custo ao lojista, deliveryFeeToSeller
  // fica 0. Plano Básico (lojista entrega, ver Shop.ifoodDeliveryBySeller) =
  // desconta o total.deliveryFee do próprio pedido, que é o valor que a
  // iFood cobrou do cliente e repassaria à entrega.
  const deliveryFeeToSeller = shop.ifoodDeliveryBySeller ? order.total?.deliveryFee ?? 0 : 0;

  const totals = computeIfoodOrderTotals(items);
  const completedAt = concludedAt ?? (order.createdAt ? new Date(order.createdAt) : new Date());

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
// Um polling por loja de cada vez - o watchdog, o "Sincronizar" manual e o
// shop-sync-watchdog podiam rodar juntos pra mesma loja, buscar os mesmos
// eventos ainda não confirmados e processar o mesmo pedido em paralelo
// (criando produto duplicado, já que não há unique em shopId+ifoodItemId).
const inFlightPolls = new Map<string, Promise<{ eventsProcessed: number }>>();

export function pollShopEvents(shopId: string): Promise<{ eventsProcessed: number }> {
  const existing = inFlightPolls.get(shopId);
  if (existing) return existing;
  const run = doPollShopEvents(shopId).finally(() => inFlightPolls.delete(shopId));
  inFlightPolls.set(shopId, run);
  return run;
}

async function doPollShopEvents(shopId: string): Promise<{ eventsProcessed: number }> {
  const { accessToken, merchantId } = await getValidAccessToken(shopId);
  const events: IfoodEvent[] = await getMerchantEvents(accessToken, merchantId);

  // Ordem cronológica: lote fora de ordem fazia o status regredir
  // (ex.: CONFIRMED gravado por cima de DISPATCHED).
  events.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Só confirma pra iFood o que foi processado com sucesso - evento
  // confirmado não volta. Antes um erro passageiro (timeout, 5xx, banco)
  // num CONCLUDED era engolido e confirmado mesmo assim: o pedido sumia do
  // faturamento pra sempre. Sem confirmação, a iFood reenvia no próximo poll.
  const handledIds: string[] = [];
  for (const event of events) {
    try {
      const status = eventStatus(event);
      if (ORDER_STATUS_CODES.has(status)) {
        await trackRecentIfoodOrderEvent(shopId, event.orderId, status);
      }

      if (CONCLUDED_CODES.has(status)) {
        await processOrder(shopId, accessToken, event.orderId, new Date(event.createdAt));
      } else if (CANCELLED_CODES.has(status)) {
        await prisma.order.deleteMany({ where: { shopId, ifoodOrderId: event.orderId } });
      }
      handledIds.push(event.id);
    } catch (err) {
      console.error('[ifood] falha ao processar evento, fica sem confirmar pra iFood reenviar', {
        shopId,
        eventId: event.id,
        orderId: event.orderId,
        err,
      });
    }
  }

  await acknowledgeEvents(accessToken, handledIds);

  // Sem isso o shop-sync-watchdog achava toda loja iFood "parada" (só o
  // runShopSync gravava lastSyncedAt) e rodava sync extra a cada 3h.
  await prisma.shop.update({ where: { id: shopId }, data: { lastSyncedAt: new Date() } });

  return { eventsProcessed: handledIds.length };
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
