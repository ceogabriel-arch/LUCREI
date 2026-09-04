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

  let profitSum = 0;
  let itemsMissingCost = 0;

  for (const li of income.items) {
    const { lineValue, shippingFeeAllocated, shopeeFeeAllocated } = allocateLineItem(li, totals);

    const product = await prisma.product.findFirst({
      where: { shopId: shopDbId, shopeeItemId: String(li.item_id) },
    });

    const productCostSnapshot = product ? Number(product.costPrice) * li.quantity_purchased : null;
    const profit = computeLineProfit(lineValue, shippingFeeAllocated, shopeeFeeAllocated, productCostSnapshot);

    if (profit === null) itemsMissingCost++;
    else profitSum += profit;

    await prisma.orderLineItem.create({
      data: {
        orderId: order.id,
        productId: product?.id,
        shopeeItemId: String(li.item_id),
        quantity: li.quantity_purchased,
        salePrice: lineValue,
        shippingFeeAllocated,
        shopeeFeeAllocated,
        productCostSnapshot: productCostSnapshot ?? undefined,
        profit: profit ?? undefined,
      },
    });
  }

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

export async function syncShopOrders(shopId: string) {
  const { accessToken, shopeeShopId } = await getValidAccessToken(shopId);

  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - 15 * 24 * 60 * 60;

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

      for (const detail of details) {
        if (!ELIGIBLE_STATUSES.has(detail.order_status)) continue;
        await processOrder(
          shopId,
          shopeeShopId,
          accessToken,
          detail.order_sn,
          detail.order_status,
          detail.create_time
        );
        ordersSynced++;
      }
    }

    hasMore = page.more;
    cursor = page.next_cursor;
  }

  await prisma.shop.update({ where: { id: shopId }, data: { lastSyncedAt: new Date() } });

  return { ordersSeen, ordersSynced };
}
