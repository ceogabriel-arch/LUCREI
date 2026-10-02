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

// Mesma ideia, mas pro Mercado Livre - que ainda não tem webhook (ver Fase 2
// "fora de escopo"), então quem chama isso é a própria sincronização
// periódica, pra TODO pedido visto (não só os já "paid") - diferente da
// Shopee, não é alimentado em tempo real por push.
export async function trackRecentMercadoLivreOrderEvent(shopId: string, orderId: string, status: string) {
  await prisma.recentOrderEvent.upsert({
    where: { mercadoLivreOrderId: orderId },
    update: { orderStatus: status },
    create: { shopId, mercadoLivreOrderId: orderId, orderStatus: status, orderDate: new Date() },
  });
}
