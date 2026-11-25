import { checkDailyGoalReached } from '../../lib/daily-goal-notifications';
import { getBillData, type Food99OrderInfo } from '../../food99-client';
import { getValidAuthToken } from '../../lib/food99-token';
import { notifyOrderCompletedIfNeeded } from '../../lib/order-notifications';
import { prisma } from '../../lib/prisma';
import { allocateFood99LineItem, computeFood99OrderTotals, totalFood99Fees } from './food99-order-math';
import { computeLineProfit, computeTaxAllocated } from './order-math';

// A 99Food empurra webhook de verdade (orderNew/orderConfirm/orderReady/
// orderCancel/orderFinish) - diferente de iFood (só polling). O Lucrei NUNCA
// chama /order/order/confirm: a loja continua aceitando pedido pelo app
// oficial da 99Food (método "B-App & API", o padrão ao vincular) - o Lucrei
// só observa pra calcular lucro, nunca decide se um pedido é aceito.
// orderNew já traz o pedido inteiro (mesmo schema do /order/order/detail,
// confirmado na documentação), então cria o Order direto nesse evento, sem
// chamada extra à API.
export async function handleOrderNew(shopId: string, orderInfo: Food99OrderInfo) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const taxRatePercent = shop.taxRatePercent != null ? Number(shop.taxRatePercent) : 0;
  const items = orderInfo.order_items ?? [];
  const totals = computeFood99OrderTotals(items);
  const completedAt = new Date(orderInfo.create_time * 1000);

  const dbOrder = await prisma.order.upsert({
    where: { food99OrderId: orderInfo.order_id },
    update: {},
    create: {
      shopId,
      food99OrderId: orderInfo.order_id,
      orderStatus: 'COMPLETED',
      orderDate: completedAt,
      completedAt,
      buyerPaidShippingFee: 0,
    },
  });

  const itemIds = items.map((it) => it.app_item_id);
  const existingProducts = await prisma.product.findMany({
    where: { shopId, food99ItemId: { in: itemIds } },
  });
  const productByItemId = new Map(existingProducts.map((p) => [p.food99ItemId!, p]));

  // Sem API de catálogo usada ainda - produto é criado sob demanda a partir
  // do próprio pedido, custo manual (0) até o lojista preencher, mesmo
  // esquema de iFood/TikTok Shop.
  for (const it of items) {
    if (!productByItemId.has(it.app_item_id)) {
      const created = await prisma.product.create({
        data: { shopId, food99ItemId: it.app_item_id, name: it.name, costPrice: 0, costSource: 'manual' },
      });
      productByItemId.set(it.app_item_id, created);
    }
  }

  const lineItemsData = items.map((it) => {
    const { lineValue } = allocateFood99LineItem(it, totals);
    const product = productByItemId.get(it.app_item_id);
    const taxAllocated = computeTaxAllocated(lineValue, taxRatePercent);
    const productCostSnapshot = product ? Number(product.costPrice) * it.amount : null;
    // feeAllocated começa em 0 - só é conhecido depois, pela reconciliação
    // financeira (ver reconcileFood99Fees abaixo), que recalcula o lucro.
    const profit = computeLineProfit(lineValue, 0, 0, productCostSnapshot, taxAllocated);

    return {
      orderId: dbOrder.id,
      productId: product?.id,
      food99ItemId: it.app_item_id,
      itemName: it.name,
      quantity: it.amount,
      salePrice: lineValue,
      shippingFeeAllocated: 0,
      shopeeFeeAllocated: 0,
      taxAllocated,
      productCostSnapshot: productCostSnapshot ?? undefined,
      profit: profit ?? undefined,
    };
  });

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${dbOrder.id} FOR UPDATE`;
    await tx.orderLineItem.deleteMany({ where: { orderId: dbOrder.id } });
    await tx.orderLineItem.createMany({ data: lineItemsData });
  });

  const totalProfit = lineItemsData.every((li) => li.profit == null) ? null : lineItemsData.reduce((s, li) => s + (li.profit ?? 0), 0);
  const totalRevenue = lineItemsData.reduce((sum, li) => sum + li.salePrice, 0);

  await prisma.shop.update({ where: { id: shopId }, data: { lastSyncedAt: new Date() } });

  await notifyOrderCompletedIfNeeded({
    orderId: dbOrder.id,
    orderSn: orderInfo.order_id,
    shopDbId: shopId,
    completedAt: dbOrder.completedAt,
    totalProfit,
    totalRevenue,
  }).catch(() => {});

  checkDailyGoalReached(shopId).catch(() => {});
}

export async function handleOrderCancel(shopId: string, orderId: string) {
  await prisma.order.deleteMany({ where: { shopId, food99OrderId: orderId } });
}

function formatDateYYYYMMDD(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// Reconciliação financeira: a comissão/taxa real da 99Food não vem no
// pedido, só por essa consulta de faturamento por período (Get Bill Data).
// Chamada pelo food99-financial-watchdog a cada poucas horas, pra trás uma
// janela de dias (o repasse costuma fechar alguns dias depois da venda, ver
// expectSettleDate na documentação).
export async function reconcileFood99Fees(shopId: string, daysBack = 5) {
  const shop = await prisma.shop.findUniqueOrThrow({ where: { id: shopId }, include: { food99OAuthToken: true } });
  if (!shop.food99OAuthToken) return { updated: 0 };

  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 24 * 60 * 60 * 1000);

  let pageNo = 1;
  let updated = 0;
  while (true) {
    // acceptor_code é o app_shop_id (= Shop.id, ver food99-client/index.ts) -
    // shop.food99ShopId é outra coisa (o shop_id da PRÓPRIA 99Food).
    const { rows, totalPages } = await getBillData(shop.id, formatDateYYYYMMDD(start), formatDateYYYYMMDD(end), pageNo);

    for (const row of rows) {
      // orderType 1 = receita do pedido (ver Get Bill Data) - os outros tipos
      // (reembolso, ajuste, taxa não ligada a pedido) ficam pra uma fase
      // seguinte, pra não arriscar descontar duas vezes a mesma taxa.
      if (row.orderType !== 1) continue;

      const order = await prisma.order.findUnique({
        where: { food99OrderId: row.orderId },
        include: { lineItems: true },
      });
      if (!order) continue;

      const totalFees = totalFood99Fees(row);
      const totalLineValue = order.lineItems.reduce((sum, li) => sum + Number(li.salePrice), 0);
      if (totalLineValue <= 0) continue;

      await prisma.$transaction(
        order.lineItems.map((li) => {
          const share = Number(li.salePrice) / totalLineValue;
          const feeAllocated = totalFees * share;
          const productCostSnapshot = li.productCostSnapshot != null ? Number(li.productCostSnapshot) : null;
          const profit = computeLineProfit(Number(li.salePrice), 0, feeAllocated, productCostSnapshot, Number(li.taxAllocated));
          return prisma.orderLineItem.update({
            where: { id: li.id },
            data: { shopeeFeeAllocated: feeAllocated, profit: profit ?? undefined },
          });
        })
      );
      updated++;
    }

    if (pageNo >= totalPages) break;
    pageNo++;
  }

  return { updated };
}
