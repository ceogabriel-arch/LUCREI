import { prisma } from './prisma';
import * as mercadopago from '../mercadopago-client';

export const PIX_EXPIRATION_MINUTES = 60 * 24;
export const CYCLE_DAYS_BY_PERIOD = { monthly: 30, annual: 365 } as const;

export function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export type PixChargeResponse = {
  qrCode: string;
  qrCodeBase64: string;
  expiresAt: string;
  amount: number;
};

export type CurrentPixCharge = PixChargeResponse | null;

/**
 * Cria o Pix na Mercado Pago e persiste o PixCharge - usado por todo mundo que
 * gera uma cobrança Pix (assinatura nova, renovação de ciclo, upgrade
 * proporcional) pra não reimplementar 3x a mesma sequência.
 *
 * Duas defesas importantes aqui:
 * - a Mercado Pago só preenche point_of_interaction/qr_code quando o
 *   pagamento fica 'pending' - um pagamento recusado na hora (dado do
 *   pagador rejeitado, regra antifraude, etc.) volta com esses campos
 *   ausentes, então checamos antes de acessar em vez de deixar estourar um
 *   TypeError.
 * - com a chave de idempotência estável, um retry legítimo do MESMO
 *   pagamento faz a Mercado Pago devolver o pagamento JÁ EXISTENTE (mesmo
 *   id) - sem o findUnique antes do create, isso bateria no índice único de
 *   mercadoPagoPaymentId e quebraria com um erro confuso em vez de
 *   simplesmente devolver a cobrança que já tínhamos salvo.
 */
export async function createOrGetPixCharge(params: {
  subscriptionId: string;
  amount: number;
  description: string;
  payerEmail: string;
  periodStart: Date;
  periodEnd: Date;
  idempotencyKey: string;
  targetPlanId?: string;
}): Promise<PixChargeResponse> {
  const pixPayment = await mercadopago.createPixPayment({
    amount: params.amount,
    description: params.description,
    payerEmail: params.payerEmail,
    externalReference: params.subscriptionId,
    expiresInMinutes: PIX_EXPIRATION_MINUTES,
    idempotencyKey: params.idempotencyKey,
  });

  if (pixPayment.status !== 'pending' || !pixPayment.point_of_interaction) {
    throw new Error(
      `Pix criado com status inesperado na Mercado Pago (${pixPayment.status}/${pixPayment.status_detail}) - sem QR code pra devolver.`
    );
  }

  const qrCode = pixPayment.point_of_interaction.transaction_data.qr_code;
  const qrCodeBase64 = pixPayment.point_of_interaction.transaction_data.qr_code_base64;
  const expiresAt = pixPayment.date_of_expiration;

  const existing = await prisma.pixCharge.findUnique({ where: { mercadoPagoPaymentId: String(pixPayment.id) } });
  if (!existing) {
    await prisma.pixCharge.create({
      data: {
        subscriptionId: params.subscriptionId,
        mercadoPagoPaymentId: String(pixPayment.id),
        amount: params.amount,
        qrCode,
        qrCodeBase64,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
        expiresAt: new Date(expiresAt),
        targetPlanId: params.targetPlanId,
      },
    });
  }

  return { qrCode, qrCodeBase64, expiresAt, amount: params.amount };
}

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

  const cycleDue = latest?.status !== 'approved' || subscription.currentPeriodEnd === null || subscription.currentPeriodEnd <= now;
  if (!cycleDue) return null;

  const periodStart = latest?.status === 'approved' && subscription.currentPeriodEnd ? subscription.currentPeriodEnd : now;
  const periodEnd = addDays(periodStart, CYCLE_DAYS_BY_PERIOD[plan.billingPeriod]);

  const charge = await createOrGetPixCharge({
    subscriptionId: subscription.id,
    amount: Number(plan.priceCurrent),
    description: `Lucrei - Plano ${plan.name}`,
    payerEmail: user.email,
    periodStart,
    periodEnd,
    idempotencyKey: mercadopago.pixIdempotencyKey(subscription.id, 'cycle'),
  });

  await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'past_due' } });
  await prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: 'past_due' } });

  return charge;
}
