import { prisma } from './prisma';

export type CouponValidation = { ok: true; coupon: { id: string; code: string; percentOff: number } } | { ok: false; message: string };

// Cupom só desconta a 1ª cobrança de uma assinatura via Pix (ver comentário
// em Subscription.pendingCouponPercentOff) - não existe fluxo de cartão
// aqui de propósito.
export async function validateCoupon(rawCode: string): Promise<CouponValidation> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, message: 'Informe um código de cupom.' };

  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.active) return { ok: false, message: 'Cupom inválido.' };
  if (coupon.expiresAt && coupon.expiresAt < new Date()) return { ok: false, message: 'Esse cupom expirou.' };
  if (coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions) {
    return { ok: false, message: 'Esse cupom já atingiu o limite de usos.' };
  }

  return { ok: true, coupon: { id: coupon.id, code: coupon.code, percentOff: coupon.percentOff } };
}

export function applyPercentOff(amount: number, percentOff: number): number {
  const discounted = amount * (1 - percentOff / 100);
  // Duas casas, sem passar de centavo por arredondamento binário de ponto
  // flutuante (0.145 * 100 vira 14.499999999999998 sem isso).
  return Math.round(discounted * 100) / 100;
}
