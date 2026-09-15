import type { Plan, User } from '@prisma/client';

import { pixIdempotencyKey } from '../mercadopago-client';
import { createOrGetPixCharge, type PixChargeResponse } from './pix-billing';
import { prisma } from './prisma';

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

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
 * Plano anual trocado no meio do ciclo por um mais caro precisa de uma
 * cobrança avulsa agora (proporcional aos meses restantes) - sem isso, a
 * pessoa ficaria no plano novo de graça até a renovação, quase um ano depois.
 * Não mexe em downgrade (sem reembolso automático), em planos mensais (o
 * ciclo é curto demais pra valer a pena complicar), nem em assinatura ainda
 * em teste grátis (nada foi pago ainda, não tem "proporcional" a cobrar).
 * Cobrança sempre por Pix,
 * independente de como a assinatura atual é paga - não temos como cobrar um
 * valor avulso no cartão salvo de uma assinatura existente na Mercado Pago.
 * Retorna null quando a troca não precisa de cobrança (caminho normal segue).
 */
export async function createProratedUpgradeCharge(
  user: User & { plan: Plan | null },
  newPlan: Plan
): Promise<ProrationCharge> {
  if (!user.plan || user.plan.id === newPlan.id) return null;
  if (user.plan.billingPeriod !== 'annual' || newPlan.billingPeriod !== 'annual') return null;
  if (user.plan.priceCurrent === null || newPlan.priceCurrent === null) return null;

  const priceDiff = Number(newPlan.priceCurrent) - Number(user.plan.priceCurrent);
  if (priceDiff <= 0) return null;

  const subscription = await findLatestPaidSubscription(user.id);
  if (!subscription?.currentPeriodEnd) return null;

  const remainingMs = subscription.currentPeriodEnd.getTime() - Date.now();
  if (remainingMs <= 0) return null;

  const remainingFraction = Math.min(1, remainingMs / YEAR_MS);
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
 * O fluxo de Pix sempre cria uma assinatura nova do zero (ver ensureCurrentPixCharge)
 * - ótimo pra assinar um plano novo, mas se a pessoa já está num plano anual pago
 * (cartão ou Pix, não importa) e pede pra trocar por um de valor igual ou menor,
 * isso jogaria fora o tempo já pago e cobraria o preço cheio do plano novo na
 * hora. Upgrade de verdade (mais caro) já é tratado à parte por
 * createProratedUpgradeCharge antes desse bloqueio entrar em ação. Só se
 * aplica a quem JÁ PAGOU o ciclo atual (ver findLatestPaidSubscription) -
 * ninguém em teste grátis "já pagou" nada, então nunca é bloqueado.
 */
export async function findActiveAnnualCycle(user: User & { plan: Plan | null }) {
  if (!user.plan || user.plan.billingPeriod !== 'annual') return null;

  const subscription = await findLatestPaidSubscription(user.id);
  if (!subscription?.currentPeriodEnd || subscription.currentPeriodEnd.getTime() <= Date.now()) return null;

  return { ...subscription, currentPeriodEnd: subscription.currentPeriodEnd };
}
