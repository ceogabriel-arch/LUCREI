import type { Plan, User } from '@prisma/client';

import * as mercadopago from '../mercadopago-client';
import { prisma } from './prisma';

const PIX_EXPIRATION_MINUTES = 60 * 24;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export type ProrationCharge = {
  qrCode: string;
  qrCodeBase64: string;
  expiresAt: string;
  amount: number;
} | null;

/**
 * Plano anual trocado no meio do ciclo por um mais caro precisa de uma
 * cobrança avulsa agora (proporcional aos meses restantes) - sem isso, a
 * pessoa ficaria no plano novo de graça até a renovação, quase um ano depois.
 * Não mexe em downgrade (sem reembolso automático) nem em planos mensais (o
 * ciclo é curto demais pra valer a pena complicar). Cobrança sempre por Pix,
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

  const subscription = await prisma.subscription.findFirst({
    where: { userId: user.id, status: { not: 'canceled' }, provider: { in: ['mercado_pago', 'mercado_pago_pix'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!subscription?.currentPeriodEnd) return null;

  const remainingMs = subscription.currentPeriodEnd.getTime() - Date.now();
  if (remainingMs <= 0) return null;

  const remainingFraction = Math.min(1, remainingMs / YEAR_MS);
  const proratedAmount = Math.round(priceDiff * remainingFraction * 100) / 100;
  if (proratedAmount <= 0) return null;

  const pixPayment = await mercadopago.createPixPayment({
    amount: proratedAmount,
    description: `Lucrei - Upgrade proporcional para ${newPlan.name}`,
    payerEmail: user.email,
    externalReference: subscription.id,
    expiresInMinutes: PIX_EXPIRATION_MINUTES,
  });

  await prisma.pixCharge.create({
    data: {
      subscriptionId: subscription.id,
      mercadoPagoPaymentId: String(pixPayment.id),
      amount: proratedAmount,
      qrCode: pixPayment.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: pixPayment.point_of_interaction.transaction_data.qr_code_base64,
      periodStart: new Date(),
      periodEnd: subscription.currentPeriodEnd,
      expiresAt: new Date(pixPayment.date_of_expiration),
      targetPlanId: newPlan.id,
    },
  });

  return {
    qrCode: pixPayment.point_of_interaction.transaction_data.qr_code,
    qrCodeBase64: pixPayment.point_of_interaction.transaction_data.qr_code_base64,
    expiresAt: pixPayment.date_of_expiration,
    amount: proratedAmount,
  };
}
