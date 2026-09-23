import type { User } from '@prisma/client';

import { prisma } from './prisma';

// Mesma carência de 7 dias do limite de vendas (getSalesLimitStatus) - dados
// borrados assim que o pagamento atrasa, sincronização trava de vez só
// depois desse prazo, dando tempo real de resolver o pagamento sem perder
// acesso na hora.
export const SUBSCRIPTION_GRACE_DAYS = 7;

export type SubscriptionAccessStatus = {
  // true assim que subscriptionStatus vira 'past_due' - é o que já dispara
  // o borrão dos valores no app.
  pastDue: boolean;
  // true só depois da carência acabar - é esse que a rota de sync usa pra
  // decidir se bloqueia de verdade.
  blocked: boolean;
  // Dias restantes de carência (0 quando já bloqueou). Null quando não se aplica.
  graceDaysLeft: number | null;
};

// currentPeriodEnd da assinatura ativa marca o fim do último período PAGO -
// só é reescrito quando um pagamento novo é confirmado (ver
// handlePaymentEvent/handlePreapprovalEvent), então continua parado nessa
// data enquanto a conta estiver em past_due. Usa isso como "desde quando"
// em vez de guardar uma coluna nova só pra isso.
export async function getSubscriptionAccessStatus(user: User): Promise<SubscriptionAccessStatus> {
  if (user.subscriptionStatus !== 'past_due') {
    return { pastDue: false, blocked: false, graceDaysLeft: null };
  }

  const subscription = await prisma.subscription.findFirst({
    where: { userId: user.id, status: { not: 'canceled' } },
    orderBy: { createdAt: 'desc' },
  });
  const since = subscription?.currentPeriodEnd ?? subscription?.createdAt ?? user.updatedAt;
  const graceExpiresAt = new Date(since.getTime() + SUBSCRIPTION_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const now = new Date();

  if (now >= graceExpiresAt) {
    return { pastDue: true, blocked: true, graceDaysLeft: 0 };
  }

  const graceDaysLeft = Math.ceil((graceExpiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return { pastDue: true, blocked: false, graceDaysLeft };
}

// Reaproveitado pelas rotas de sync (dia a dia e backfill de histórico), do
// mesmo jeito que checkSalesLimitBlock - carência esgotada não deixa
// continuar sincronizando pedido novo enquanto o pagamento não for feito.
export async function checkSubscriptionAccessBlock(
  userId: string
): Promise<{ blocked: false } | { blocked: true; message: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { blocked: false };

  const status = await getSubscriptionAccessStatus(user);
  if (!status.blocked) return { blocked: false };

  return {
    blocked: true,
    message: 'Seu pagamento está em atraso e o prazo de carência já acabou. Regularize pra continuar sincronizando pedidos.',
  };
}
