import { prisma } from '../../lib/prisma';
import { getEscrowDetail, getOrderDetail, getOrderList } from '../../shopee-client';

const ELIGIBLE_STATUSES = new Set(['COMPLETED']);

export async function syncShopOrders(shopId: string) {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { oauthToken: true },
  });
  if (!shop.oauthToken) {
    throw new Error('Loja sem token de acesso salvo.');
  }

  const accessToken = shop.oauthToken.accessToken;
  const shopeeShopId = Number(shop.shopeeShopId);

  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - 15 * 24 * 60 * 60;

  let cursor = '';
  let hasMore = true;
  let ordersSeen = 0;
  let ordersSynced = 0;

  while (hasMore) {
    const page = await getOrderList(accessToken, shopeeShopId, { timeFrom, timeTo, cursor });
    const eligible = page.order_list.filter((o) => ELIGIBLE_STATUSES.has(o.order_status));
    ordersSeen += page.order_list.length;

    const createTimeBySn = new Map<string, number>();
    if (eligible.length > 0) {
      const details = await getOrderDetail(
        accessToken,
        shopeeShopId,
        eligible.map((o) => o.order_sn)
      );
      for (const d of details) createTimeBySn.set(d.order_sn, d.create_time);
    }

    for (const item of eligible) {
      const escrow = await getEscrowDetail(accessToken, shopeeShopId, item.order_sn);
      const income = escrow.order_income;

      const totalItemValue = income.items.reduce(
        (sum, li) => sum + li.discounted_price * li.quantity_purchased,
        0
      );
      const netShippingCost = Math.max(income.actual_shipping_fee - income.buyer_paid_shipping_fee, 0);
      const totalShopeeFee = income.commission_fee + income.service_fee;
      const createTime = createTimeBySn.get(item.order_sn);

      const order = await prisma.order.upsert({
        where: { shopeeOrderSn: item.order_sn },
        update: {
          orderStatus: item.order_status,
          buyerPaidShippingFee: income.buyer_paid_shipping_fee,
          escrowAmount: income.escrow_amount,
          escrowSyncedAt: new Date(),
        },
        create: {
          shopId: shop.id,
          shopeeOrderSn: item.order_sn,
          orderStatus: item.order_status,
          orderDate: createTime ? new Date(createTime * 1000) : new Date(),
          buyerPaidShippingFee: income.buyer_paid_shipping_fee,
          escrowAmount: income.escrow_amount,
          escrowSyncedAt: new Date(),
        },
      });

      await prisma.orderLineItem.deleteMany({ where: { orderId: order.id } });

      for (const li of income.items) {
        const lineValue = li.discounted_price * li.quantity_purchased;
        const share = totalItemValue > 0 ? lineValue / totalItemValue : 0;

        const product = await prisma.product.findFirst({
          where: { shopId: shop.id, shopeeItemId: String(li.item_id) },
        });

        const shippingFeeAllocated = netShippingCost * share;
        const shopeeFeeAllocated = totalShopeeFee * share;
        const productCostSnapshot = product ? Number(product.costPrice) * li.quantity_purchased : null;
        const profit =
          productCostSnapshot !== null
            ? lineValue - shippingFeeAllocated - shopeeFeeAllocated - productCostSnapshot
            : null;

        await prisma.orderLineItem.create({
          data: {
            orderId: order.id,
            productId: product?.id,
            quantity: li.quantity_purchased,
            salePrice: lineValue,
            shippingFeeAllocated,
            shopeeFeeAllocated,
            productCostSnapshot: productCostSnapshot ?? undefined,
            profit: profit ?? undefined,
          },
        });
      }

      ordersSynced++;
    }

    hasMore = page.more;
    cursor = page.next_cursor;
  }

  await prisma.shop.update({ where: { id: shop.id }, data: { lastSyncedAt: new Date() } });

  return { ordersSeen, ordersSynced };
}
