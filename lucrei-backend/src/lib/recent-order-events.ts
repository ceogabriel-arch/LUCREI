import { prisma } from './prisma';

// Só alimenta o contador de "pedidos recém-comprados" (previsão de lucro do
// Início) - nunca o faturamento/lucro real, que continua vindo só de Order
// (pedido COMPLETED). Uma linha por pedido: create na primeira vez que
// vemos esse order_sn, update pra só atualizar o status nas vezes seguintes
// (orderDate fica travado no primeiro push, é quando "vimos" o pedido).
export async function trackRecentOrderEvent(shopId: string, orderSn: string, status: string) {
  await prisma.recentOrderEvent.upsert({
    where: { shopeeOrderSn: orderSn },
    update: { orderStatus: status },
    create: { shopId, shopeeOrderSn: orderSn, orderStatus: status, orderDate: new Date() },
  });
}
