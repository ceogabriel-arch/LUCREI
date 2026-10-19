import type { Plan, User } from '@prisma/client';

import { applyPercentOff } from './coupons';
import { createOneTimePaymentLink, priceToCents } from '../hypercash-client';
import { CYCLE_DAYS_BY_PERIOD } from './pix-billing';
import { prisma } from './prisma';

export type ProrationCharge = { checkoutUrl: string; amount: number } | null;

const BACK_URL = process.env.PUBLIC_APP_URL || 'https://lucrei-production-bce6.up.railway.app';

// Assinatura 'trialing' ainda não pagou nada - currentPeriodEnd nela é
// trialEndsAt, não uma data paga. Tratar isso como "ciclo anual já pago"
// cobraria (ou bloquearia troca de) alguém que está de graça no teste.
async function findLatestPaidSubscription(userId: string) {
  return prisma.subscription.findFirst({
    where: { userId, status: { in: ['active', 'past_due'] }, provider: 'hypercash' },
    orderBy: { createdAt: 'desc' },
  });
}

// Mesma conta usada pra criar a cobrança de verdade (createProratedUpgradeCharge)
// e pra só MOSTRAR o valor antes de qualquer cobrança (computeUpgradePreview,
// usado pelo card de planos) - extraído separado pra nunca os dois caminhos
// calcularem o valor de um jeito ligeiramente diferente. Sem efeito colateral
// nenhum (não mexe no banco nem chama a HyperCash).
async function computeProratedAmount(user: User & { plan: Plan | null }, newPlan: Plan): Promise<number | null> {
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
  const rawProratedAmount = Math.round(priceDiff * remainingFraction * 100) / 100;
  if (rawProratedAmount <= 0) return null;

  // Mesmo desconto "pra sempre" que já vale pra cada nova cobrança recorrente
  // (ver pendingCouponPercentOff) - sem isso, alguém com cupom pagaria cheio
  // só na cobrança proporcional do upgrade, inconsistente com o resto.
  const proratedAmount =
    subscription.pendingCouponPercentOff != null
      ? applyPercentOff(rawProratedAmount, subscription.pendingCouponPercentOff)
      : rawProratedAmount;
  return proratedAmount > 0 ? proratedAmount : null;
}

/**
 * Só CALCULA o valor proporcional, sem criar cobrança nenhuma - usado pelo
 * card de planos pra mostrar "hoje: R$X" antes da pessoa tocar em "Fazer
 * upgrade" (pedido ao vivo: card mostrava o preço cheio, só o aviso depois
 * do toque mostrava o valor de verdade, confuso sem contexto nenhum).
 */
export async function computeUpgradePreview(user: User & { plan: Plan | null }, newPlan: Plan): Promise<number | null> {
  return computeProratedAmount(user, newPlan);
}

/**
 * Plano trocado no meio do ciclo por um mais caro precisa de uma cobrança
 * avulsa agora (proporcional ao tempo restante) - sem isso, a pessoa ficaria
 * no plano novo de graça até a renovação. Essa cobrança fica presa à
 * assinatura ATUAL (não cria/cancela nada) e o plano só é aplicado de
 * verdade quando o pagamento é confirmado via webhook (ver
 * handleUpgradeChargePaid em billing/routes.ts, correlacionado por
 * HypercashUpgradeCharge.paymentLinkId) - a assinatura antiga, já paga,
 * continua intacta se a pessoa abandonar esse pagamento. Não mexe em
 * downgrade (sem reembolso automático - ver findActivePaidCycle, que
 * bloqueia até a renovação), em troca de período de cobrança (mensal<->anual
 * muda a frequência de cobrança, não é só valor), nem em assinatura ainda em
 * teste grátis (nada foi pago ainda, não tem "proporcional" a cobrar).
 * Retorna null quando a troca não precisa de cobrança (caminho normal segue).
 */
export async function createProratedUpgradeCharge(
  user: User & { plan: Plan | null },
  newPlan: Plan
): Promise<ProrationCharge> {
  const proratedAmount = await computeProratedAmount(user, newPlan);
  if (proratedAmount === null) return null;

  // Já confirmada como não-nula pela mesma checagem dentro de
  // computeProratedAmount acima - buscada de novo aqui só porque o id da
  // assinatura (pra linkar a HypercashUpgradeCharge) não sai de lá.
  const subscription = await findLatestPaidSubscription(user.id);
  if (!subscription) return null;

  // Sempre gera um link novo (não tenta reaproveitar um pendente de uma
  // tentativa anterior) - mais simples, e inofensivo mesmo que a pessoa
  // abandone várias tentativas: cada link vira sua própria
  // HypercashUpgradeCharge, e pagar qualquer um deles aplica o mesmo
  // targetPlanId corretamente (ver handleUpgradeChargePaid).
  const link = await createOneTimePaymentLink({
    name: `Lucrei - Upgrade proporcional para ${newPlan.name}`,
    priceCents: priceToCents(proratedAmount),
    successRedirectUrl: `${BACK_URL}/planos`,
  });

  await prisma.hypercashUpgradeCharge.create({
    data: {
      subscriptionId: subscription.id,
      targetPlanId: newPlan.id,
      paymentLinkId: link.id,
      amount: proratedAmount,
    },
  });

  return { checkoutUrl: link.checkoutUrl!, amount: proratedAmount };
}

/**
 * Trocar de plano sempre cancela a assinatura atual e cria uma nova do zero
 * (ver /plans/select) - ótimo pra assinar um plano novo, mas se a pessoa já
 * está num plano pago (mensal ou anual) e pede pra trocar por um de valor
 * igual ou menor, isso cancelaria a assinatura já paga ANTES da nova ser
 * confirmada - exatamente o bug de "plano some ao cancelar o pagamento".
 * Upgrade de verdade (mais caro, mesmo período de cobrança) já é tratado à
 * parte por createProratedUpgradeCharge antes desse bloqueio entrar em ação,
 * sem cancelar nada até o pagamento confirmar. Downgrade e troca de período
 * de cobrança (mensal<->anual) não têm esse caminho seguro ainda, então
 * ficam bloqueados até a renovação. Só se aplica a quem JÁ PAGOU o ciclo
 * atual (ver findLatestPaidSubscription) - ninguém em teste grátis "já
 * pagou" nada, então nunca é bloqueado.
 */
export async function findActivePaidCycle(user: User & { plan: Plan | null }) {
  if (!user.plan || user.plan.priceCurrent === null) return null;

  const subscription = await findLatestPaidSubscription(user.id);
  if (!subscription?.currentPeriodEnd || subscription.currentPeriodEnd.getTime() <= Date.now()) return null;

  return { ...subscription, currentPeriodEnd: subscription.currentPeriodEnd };
}
