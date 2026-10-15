import type { Plan, User } from '@prisma/client';

import { prisma } from './prisma';

export type ProrationCharge = { checkoutUrl: string } | null;

// Assinatura 'trialing' ainda não pagou nada - currentPeriodEnd nela é
// trialEndsAt, não uma data paga. Tratar isso como "ciclo anual já pago"
// cobraria (ou bloquearia troca de) alguém que está de graça no teste.
async function findLatestPaidSubscription(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId, status: { in: ['active', 'past_due'] }, provider: 'hypercash' },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * TEMPORARIAMENTE DESATIVADO (migração Mercado Pago -> HyperCash, ver
 * conversa). A versão anterior cobrava a diferença proporcional via Pix
 * avulso da Mercado Pago, aplicando o upgrade só quando o webhook confirmava
 * o pagamento (ver handleUpgradeChargePaid em billing/routes.ts, que
 * correlacionava pelo targetPlanId guardado no PixCharge). A HyperCash não
 * tem um equivalente de "cobrança avulsa presa a uma assinatura" com esse
 * mesmo rastreamento, e a categoria de webhook de compra avulsa
 * ("Transação/Infração") ainda não foi configurada nem teve a assinatura
 * confirmada - fazer isso sem essa confirmação arriscaria perder o dinheiro
 * do cliente sem aplicar o upgrade. Até resolver isso, upgrade no meio do
 * ciclo cai no mesmo bloqueio que downgrade já tinha (ver
 * findActivePaidCycle): só é possível trocar de plano depois da renovação.
 * Sem impacto imediato - não existe assinatura paga ativa hoje (conferido ao
 * vivo nesta sessão).
 */
export async function createProratedUpgradeCharge(_user: User & { plan: Plan | null }, _newPlan: Plan): Promise<ProrationCharge> {
  return null;
}

/**
 * Trocar de plano sempre cancela a assinatura atual e cria uma nova do zero
 * (ver /plans/select) - ótimo pra assinar um plano novo, mas se a pessoa já
 * está num plano pago (mensal ou anual) e
 * pede pra trocar por um de valor igual ou menor, isso cancelaria a
 * assinatura já paga ANTES da nova ser confirmada - exatamente o bug de
 * "plano some ao cancelar o pagamento". Upgrade (mais caro, mesmo período de
 * cobrança) passava por createProratedUpgradeCharge antes desse bloqueio
 * entrar em ação - temporariamente desativado (ver comentário lá), então
 * por enquanto cai no mesmo bloqueio que downgrade e troca de período de
 * cobrança (mensal<->anual) já tinham: só é possível trocar de plano depois
 * da renovação. Só
 * se aplica a quem JÁ PAGOU o ciclo atual (ver findLatestPaidSubscription) -
 * ninguém em teste grátis "já pagou" nada, então nunca é bloqueado.
 */
export async function findActivePaidCycle(user: User & { plan: Plan | null }) {
  if (!user.plan || user.plan.priceCurrent === null) return null;

  const subscription = await findLatestPaidSubscription(user.id);
  if (!subscription?.currentPeriodEnd || subscription.currentPeriodEnd.getTime() <= Date.now()) return null;

  return { ...subscription, currentPeriodEnd: subscription.currentPeriodEnd };
}
