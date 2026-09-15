import { prisma } from './prisma';
import * as mercadopago from '../mercadopago-client';

const PIX_EXPIRATION_MINUTES = 60 * 24;
export const CYCLE_DAYS_BY_PERIOD = { monthly: 30, annual: 365 } as const;

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export type CurrentPixCharge = {
  qrCode: string;
  qrCodeBase64: string;
  expiresAt: string;
  amount: number;
} | null;

/**
 * Pix não tem cobrança automática recorrente como cartão - cada ciclo precisa
 * de um QR code novo. Chamado sempre que o app abre a tela de plano/fatura:
 * devolve a cobrança pendente atual, gera uma nova se a anterior expirou, ou
 * gera a do próximo ciclo se o período pago já acabou.
 */
export async function ensureCurrentPixCharge(userId: string): Promise<CurrentPixCharge> {
  const subscription = await prisma.subscription.findFirst({
    where: { userId, provider: 'mercado_pago_pix', status: { not: 'canceled' } },
    orderBy: { createdAt: 'desc' },
    // targetPlanId: null filtra cobranças avulsas de "upgrade proporcional" -
    // uma dessas abandonada (expirada, nunca paga) não pode ser confundida
    // com o estado do ciclo normal de renovação, senão dispara uma cobrança
    // nova de ciclo completo achando que o período pago já venceu.
    include: { pixCharges: { where: { targetPlanId: null }, orderBy: { createdAt: 'desc' }, take: 1 } },
  });
  if (!subscription) return null;
  // Em teste grátis ainda não há nada pra cobrar - sem essa checagem, só
  // abrir a tela de fatura durante o trial já geraria uma cobrança Pix real
  // e derrubaria o status pra "past_due", cancelando o teste na hora.
  if (subscription.status === 'trialing') return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.planId) return null;
  const plan = await prisma.plan.findUnique({ where: { id: user.planId } });
  if (!plan || plan.priceCurrent === null) return null;

  const latest = subscription.pixCharges[0];
  const now = new Date();

  if (latest?.status === 'pending' && latest.expiresAt > now) {
    return {
      qrCode: latest.qrCode,
      qrCodeBase64: latest.qrCodeBase64,
      expiresAt: latest.expiresAt.toISOString(),
      amount: Number(latest.amount),
    };
  }

  const cycleDue = !latest || latest.status !== 'approved' || subscription.currentPeriodEnd === null || subscription.currentPeriodEnd <= now;
  if (!cycleDue) return null;

  const periodStart = latest?.status === 'approved' && subscription.currentPeriodEnd ? subscription.currentPeriodEnd : now;
  const periodEnd = addDays(periodStart, CYCLE_DAYS_BY_PERIOD[plan.billingPeriod]);

  const pixPayment = await mercadopago.createPixPayment({
    amount: Number(plan.priceCurrent),
    description: `Lucrei - Plano ${plan.name}`,
    payerEmail: user.email,
    externalReference: subscription.id,
    expiresInMinutes: PIX_EXPIRATION_MINUTES,
    idempotencyKey: mercadopago.pixIdempotencyKey(subscription.id, 'cycle'),
  });

  await prisma.pixCharge.create({
    data: {
      subscriptionId: subscription.id,
      mercadoPagoPaymentId: String(pixPayment.id),
      amount: plan.priceCurrent,
      qrCode: pixPayment.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: pixPayment.point_of_interaction.transaction_data.qr_code_base64,
      periodStart,
      periodEnd,
      expiresAt: new Date(pixPayment.date_of_expiration),
    },
  });

  await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'past_due' } });
  await prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: 'past_due' } });

  return {
    qrCode: pixPayment.point_of_interaction.transaction_data.qr_code,
    qrCodeBase64: pixPayment.point_of_interaction.transaction_data.qr_code_base64,
    expiresAt: pixPayment.date_of_expiration,
    amount: Number(plan.priceCurrent),
  };
}
