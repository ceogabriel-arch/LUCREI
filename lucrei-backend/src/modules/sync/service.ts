import { mapLimit } from '../../lib/concurrency';
import { prisma } from '../../lib/prisma';
import { getValidAccessToken } from '../../lib/shopee-token';
import { getEscrowDetail, getOrderDetail, getOrderList } from '../../shopee-client';
import { allocateLineItem, computeLineProfit, computeOrderTotals } from './order-math';

const ELIGIBLE_STATUSES = new Set(['COMPLETED']);

async function processOrder(
  shopDbId: string,
  shopeeShopId: number,
  accessToken: string,
  orderSn: string,
  orderStatus: string,
  createTime?: number
) {
  const escrow = await getEscrowDetail(accessToken, shopeeShopId, orderSn);
  const income = escrow.order_income;

  const totals = computeOrderTotals(
    income.items,
    income.actual_shipping_fee,
    income.buyer_paid_shipping_fee,
    income.commission_fee,
    income.service_fee
  );

  const order = await prisma.order.upsert({
    where: { shopeeOrderSn: orderSn },
    update: {
      orderStatus,
      buyerPaidShippingFee: income.buyer_paid_shipping_fee,
      escrowAmount: income.escrow_amount,
      escrowSyncedAt: new Date(),
    },
    create: {
      shopId: shopDbId,
      shopeeOrderSn: orderSn,
      orderStatus,
      orderDate: createTime ? new Date(createTime * 1000) : new Date(),
      buyerPaidShippingFee: income.buyer_paid_shipping_fee,
      escrowAmount: income.escrow_amount,
      escrowSyncedAt: new Date(),
    },
  });

  await prisma.orderLineItem.deleteMany({ where: { orderId: order.id } });

  const itemIds = income.items.map((li) => String(li.item_id));
  const products = await prisma.product.findMany({
    where: { shopId: shopDbId, shopeeItemId: { in: itemIds } },
  });
  const productByItemId = new Map<string, (typeof products)[number]>();
  for (const p of products) {
    if (p.shopeeItemId && !productByItemId.has(p.shopeeItemId)) productByItemId.set(p.shopeeItemId, p);
  }

  let profitSum = 0;
  let itemsMissingCost = 0;

  const lineItemsData = income.items.map((li) => {
    const { lineValue, shippingFeeAllocated, shopeeFeeAllocated } = allocateLineItem(li, totals);
    const product = productByItemId.get(String(li.item_id));

    const productCostSnapshot = product ? Number(product.costPrice) * li.quantity_purchased : null;
    const profit = computeLineProfit(lineValue, shippingFeeAllocated, shopeeFeeAllocated, productCostSnapshot);

    if (profit === null) itemsMissingCost++;
    else profitSum += profit;

    return {
      orderId: order.id,
      productId: product?.id,
      shopeeItemId: String(li.item_id),
      quantity: li.quantity_purchased,
      salePrice: lineValue,
      shippingFeeAllocated,
      shopeeFeeAllocated,
      productCostSnapshot: productCostSnapshot ?? undefined,
      profit: profit ?? undefined,
    };
  });

  await prisma.orderLineItem.createMany({ data: lineItemsData });

  // Segue o mesmo critério da rota de listagem de pedidos: só null quando
  // NENHUM item do pedido tem custo cadastrado.
  const totalProfit = itemsMissingCost === income.items.length ? null : profitSum;

  return { orderId: order.id, totalProfit };
}

export async function syncOneOrder(shopId: string, orderSn: string, orderStatus: string) {
  const { accessToken, shopeeShopId } = await getValidAccessToken(shopId);
  const [detail] = await getOrderDetail(accessToken, shopeeShopId, [orderSn]);
  return processOrder(shopId, shopeeShopId, accessToken, orderSn, orderStatus, detail?.create_time);
}

// get_order_list da Shopee só aceita um intervalo de até 15 dias por
// chamada - por isso a sincronização do dia a dia (abaixo) e o backfill de
// histórico (mais abaixo) precisam varrer o tempo em blocos desse tamanho.
const WINDOW_SECONDS = 15 * 24 * 60 * 60;

async function syncWindow(shopId: string, shopeeShopId: number, accessToken: string, timeFrom: number, timeTo: number) {
  let cursor = '';
  let hasMore = true;
  let ordersSeen = 0;
  let ordersSynced = 0;

  while (hasMore) {
    const page = await getOrderList(accessToken, shopeeShopId, { timeFrom, timeTo, cursor });
    ordersSeen += page.order_list.length;

    if (page.order_list.length > 0) {
      // get_order_list nem sempre retorna order_status no item — o status confiável
      // vem do get_order_detail, então buscamos o detalhe de todos antes de filtrar.
      const details = await getOrderDetail(
        accessToken,
        shopeeShopId,
        page.order_list.map((o) => o.order_sn)
      );

      const eligibleDetails = details.filter((detail) => ELIGIBLE_STATUSES.has(detail.order_status));

      // Cada pedido faz sua própria chamada de get_escrow_detail (a Shopee só
      // aceita um order_sn por vez ali) mais algumas idas ao banco - processar
      // um de cada vez fazia a sincronização inteira escalar linearmente com
      // o número de pedidos, dominada por ida-e-volta de rede. Mesmo limite
      // de 10 já usado pra get_model_list em products/routes.ts, pra não
      // estourar o rate limit da Shopee.
      await mapLimit(eligibleDetails, 10, (detail) =>
        processOrder(shopId, shopeeShopId, accessToken, detail.order_sn, detail.order_status, detail.create_time)
      );
      ordersSynced += eligibleDetails.length;
    }

    hasMore = page.more;
    cursor = page.next_cursor;
  }

  return { ordersSeen, ordersSynced };
}

export async function syncShopOrders(shopId: string) {
  const { accessToken, shopeeShopId } = await getValidAccessToken(shopId);

  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - WINDOW_SECONDS;

  const result = await syncWindow(shopId, shopeeShopId, accessToken, timeFrom, timeTo);

  await prisma.shop.update({ where: { id: shopId }, data: { lastSyncedAt: new Date() } });

  return result;
}

// Backfill manual (botão "Sincronizar histórico" em Relatórios) - a
// sincronização normal acima só cobre os últimos 15 dias, então pedidos mais
// antigos que isso nunca entram no banco sozinhos. Varre de trás pra frente
// (mais recente primeiro) até "sinceDate", em blocos de 15 dias.
export async function syncShopOrdersHistory(shopId: string, sinceDate: Date) {
  const { accessToken, shopeeShopId } = await getValidAccessToken(shopId);

  const sinceSec = Math.floor(sinceDate.getTime() / 1000);
  let windowEnd = Math.floor(Date.now() / 1000);
  let ordersSeen = 0;
  let ordersSynced = 0;
  let windowsFailed = 0;
  let lastError: unknown = null;

  while (windowEnd > sinceSec) {
    const windowStart = Math.max(sinceSec, windowEnd - WINDOW_SECONDS);
    try {
      const result = await syncWindow(shopId, shopeeShopId, accessToken, windowStart, windowEnd);
      ordersSeen += result.ordersSeen;
      ordersSynced += result.ordersSynced;
    } catch (err) {
      // Um bloco de 15 dias falhar (ex: janela antiga demais pra Shopee
      // aceitar) não pode derrubar o backfill inteiro - registra e segue pros
      // blocos mais recentes, que são os que mais importam.
      windowsFailed++;
      lastError = err;
    }
    windowEnd = windowStart;
  }

  await prisma.shop.update({ where: { id: shopId }, data: { lastSyncedAt: new Date() } });

  if (ordersSynced === 0 && windowsFailed > 0 && lastError instanceof Error) {
    throw lastError;
  }

  return { ordersSeen, ordersSynced, windowsFailed };
}
