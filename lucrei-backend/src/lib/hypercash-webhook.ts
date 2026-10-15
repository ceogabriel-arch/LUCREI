import crypto from 'node:crypto';

// Formato confirmado ao vivo contra um evento de teste real da HyperCash
// (botão "Testar webhook" no painel deles, documentação pública não cobre
// isso): header "t=<timestamp>,v1=<hash>", hash = HMAC-SHA256 de
// "{timestamp}.{corpo bruto}" usando a chave completa (com o prefixo
// "whsec_" incluído) - mesmo esquema da Stripe.
const TOLERANCE_SECONDS = 5 * 60;

export function verifyHypercashSignature(sigHeader: string | undefined, rawBody: string, secret: string): boolean {
  if (!sigHeader || !secret) return false;

  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=')));
  const timestamp = parts.t;
  const providedV1 = parts.v1;
  if (!timestamp || !providedV1) return false;

  // Sem essa checagem, um evento assinado de verdade (capturado por quem
  // fizer man-in-the-middle, ou vazado em log) continuaria válido pra
  // sempre - a janela de tolerância limita o estrago de uma assinatura
  // reaproveitada.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > TOLERANCE_SECONDS) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return expected.length === providedV1.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(providedV1));
}
