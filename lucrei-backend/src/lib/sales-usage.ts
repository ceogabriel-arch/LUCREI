import type { Plan, User } from '@prisma/client';

import { prisma } from './prisma';
import { startOfCurrentMonth } from './period';

// "Vendas/mês" é por conta, não por loja - soma pedidos de todas as lojas do
// usuário nesse mês corrente.
export function getOrdersThisMonth(userId: string) {
  return prisma.order.count({
    where: { shop: { userId }, orderDate: { gte: startOfCurrentMonth() } },
  });
}

// Ao bater 100% do limite, não trava a sincronização na hora - libera mais
// alguns dias (o app borra os dados de pedidos/lucro nesse meio tempo,
// incentivando o upgrade) antes do bloqueio de verdade.
export const GRACE_PERIOD_DAYS = 7;

export type SalesLimitStatus = {
  ordersThisMonth: number;
  salesLimit: number | null;
  // true assim que bate o limite, mesmo ainda dentro da carência.
  overLimit: boolean;
  // true só depois da carência acabar - é esse que a rota de sync usa pra
  // decidir se bloqueia de verdade.
  blocked: boolean;
  // Dias restantes de carência (0 quando já bloqueou). Null quando não se aplica.
  graceDaysLeft: number | null;
};

// Fonte única dessa lógica - usada tanto pela rota de sync (decide se
// bloqueia) quanto pela de status (o app usa pra saber quando borrar os
// dados). Duplicar essa conta em dois lugares arriscaria os dois discordarem
// sobre se a conta está ou não em carência.
export async function getSalesLimitStatus(user: User & { plan: Plan | null }): Promise<SalesLimitStatus> {
  const ordersThisMonth = await getOrdersThisMonth(user.id);
  const salesLimit = user.plan?.salesLimit ?? null;

  if (salesLimit == null || ordersThisMonth < salesLimit) {
    return { ordersThisMonth, salesLimit, overLimit: false, blocked: false, graceDaysLeft: null };
  }

  const reachedAt =
    user.salesLimitReachedAt && user.salesLimitReachedAt >= startOfCurrentMonth() ? user.salesLimitReachedAt : null;
  if (!reachedAt) {
    // Só acontece entre bater o limite e a próxima sincronização gravar
    // salesLimitReachedAt - trata como recém-atingido, carência cheia.
    return { ordersThisMonth, salesLimit, overLimit: true, blocked: false, graceDaysLeft: GRACE_PERIOD_DAYS };
  }

  const graceExpiresAt = new Date(reachedAt.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();
  if (now >= graceExpiresAt) {
    return { ordersThisMonth, salesLimit, overLimit: true, blocked: true, graceDaysLeft: 0 };
  }

  const graceDaysLeft = Math.ceil((graceExpiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return { ordersThisMonth, salesLimit, overLimit: true, blocked: false, graceDaysLeft };
}
