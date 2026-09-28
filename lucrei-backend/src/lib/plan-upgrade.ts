import type { Plan, User } from '@prisma/client';

import { pixIdempotencyKey } from '../mercadopago-client';
import { CYCLE_DAYS_BY_PERIOD, createOrGetPixCharge, type PixChargeResponse } from './pix-billing';
import { prisma } from './prisma';

export type ProrationCharge = PixChargeResponse | null;

// Assinatura 'trialing' ainda não pagou nada - currentPeriodEnd nela é
// trialEndsAt, não uma data paga. Tratar isso como "ciclo anual já pago"
// cobraria (ou bloquearia troca de) alguém que está de graça no teste.
async function findLatestPaidSubscription(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId, status: { in: ['active', 'past_due'] }, provider: { in: ['mercado_pago', 'mercado_pago_pix'] } },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Plano trocado no meio do ciclo (mensal ou anual) por um mais caro precisa
 * de uma cobrança avulsa agora (proporcional ao tempo restante) - sem isso,
 * a pessoa ficaria no plano novo de graça até a renovação. Crucial: essa
 * cobrança fica presa à assinatura ATUAL (não cria/cancela nada) e o plano
 * só é aplicado de verdade quando o pagamento é confirmado via webhook (ver
 * handleUpgradeChargePaid) - a assinatura antiga, já paga, continua intacta
 * se a pessoa abandonar esse pagamento. Não mexe em downgrade (sem reembolso
 * automático - ver findActivePaidCycle, que bloqueia até a renovação), em
 * troca de período de cobrança (mensal<->anual muda a frequência de cobrança
 * na Mercado Pago, não é só valor), nem em assinatura ainda em teste grátis
 * (nada foi pago ainda, não tem "proporcional" a cobrar). Cobrança sempre
 * por Pix, independente de como a assinatura atual é paga - não temos como
 * cobrar um valor avulso no cartão salvo de uma assinatura existente na
 * Mercado Pago.
 * Retorna null quando a troca não precisa de cobrança (caminho normal segue).
 */
export async function createProratedUpgradeCharge(
  user: User & { plan: Plan | null },
  newPlan: Plan
): Promise<ProrationCharge> {
  if (!user.plan || user.plan.id === newPlan.id) return null;
  if (user.plan.billingPeriod !== newPlan.billingPeriod) return null;
  if (user.plan.priceCurrent === null || newPlan.priceCurrent === null) return null;

  const priceDiff = Number(newPlan.priceCurrent) - Number(user.plan.priceCurrent);
  if (priceDiff <= 0) return null;

  const subscription = await findLatestPaidSubscription(user.id);
  if (!subscription?.currentPeriodEnd) return null;

  const remainingMs = subscription.currentPeriodEnd.getTime() - Date.now();
  if (remainingMs <= 0) return null;

  const cycleMs = CYCLE_DAYS_BY_PERIOD[user.plan.billingPeriod] * 24 * 60 * 60 * 1000;
  const remainingFraction = Math.min(1, remainingMs / cycleMs);
  const proratedAmount = Math.round(priceDiff * remainingFraction * 100) / 100;
  if (proratedAmount <= 0) return null;

  return createOrGetPixCharge({
    subscriptionId: subscription.id,
    amount: proratedAmount,
    description: `Lucrei - Upgrade proporcional para ${newPlan.name}`,
    payerEmail: user.email,
    periodStart: new Date(),
    periodEnd: subscription.currentPeriodEnd,
    idempotencyKey: pixIdempotencyKey(subscription.id, 'upgrade', newPlan.id),
    targetPlanId: newPlan.id,
  });
}

/**
 * Trocar de plano sempre cancela a assinatura atual e cria uma nova do zero
 * (ver /plans/select e /plans/select-pix) - ótimo pra assinar um plano novo,
 * mas se a pessoa já está num plano pago (mensal ou anual, cartão ou Pix) e
 * pede pra trocar por um de valor igual ou menor, isso cancelaria a
 * assinatura já paga ANTES da nova ser confirmada - exatamente o bug de
 * "plano some ao cancelar o pagamento". Upgrade de verdade (mais caro, mesmo
 * período de cobrança) já é tratado à parte por createProratedUpgradeCharge
 * antes desse bloqueio entrar em ação, sem cancelar nada até o pagamento
 * confirmar. Downgrade e troca de período de cobrança (mensal<->anual) não
 * têm esse caminho seguro ainda, então ficam bloqueados até a renovação. Só
 * se aplica a quem JÁ PAGOU o ciclo atual (ver findLatestPaidSubscription) -
 * ninguém em teste grátis "já pagou" nada, então nunca é bloqueado.
 */
export async function findActivePaidCycle(user: User & { plan: Plan | null }) {
  if (!user.plan || user.plan.priceCurrent === null) return null;

  const subscription = await findLatestPaidSubscription(user.id);
  if (!subscription?.currentPeriodEnd || subscription.currentPeriodEnd.getTime() <= Date.now()) return null;

  return { ...subscription, currentPeriodEnd: subscription.currentPeriodEnd };
}
