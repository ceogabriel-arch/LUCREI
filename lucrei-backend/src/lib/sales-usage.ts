import { prisma } from './prisma';
import { startOfCurrentMonth } from './period';

// "Vendas/mês" é por conta, não por loja - soma pedidos de todas as lojas do
// usuário nesse mês corrente.
export function getOrdersThisMonth(userId: string) {
  return prisma.order.count({
    where: { shop: { userId }, orderDate: { gte: startOfCurrentMonth() } },
  });
}
