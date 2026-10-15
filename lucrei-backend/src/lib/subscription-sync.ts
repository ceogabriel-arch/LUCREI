import { prisma } from './prisma';
import { getPreapproval } from '../mercadopago-client';
import { getSubscriptionByPaymentLinkId, type HypercashSubscription } from '../hypercash-client';

export function mapMercadoPagoStatus(mpStatus: string): 'active' | 'past_due' | 'canceled' | null {
  if (mpStatus === 'authorized') return 'active';
  if (mpStatus === 'paused') return 'past_due';
  if (mpStatus === 'cancelled') return 'canceled';
  return null;
}

// paused/payment_failed viram 'past_due' (bloqueia acesso com carência, não
// cancela de vez) - expired/cancelled viram 'canceled' de verdade, já que
// nenhum dos dois volta a cobrar sozinho.
export function mapHypercashStatus(hcStatus: HypercashSubscription['status']): 'active' | 'past_due' | 'canceled' {
  if (hcStatus === 'active') return 'active';
  if (hcStatus === 'paused' || hcStatus === 'payment_failed') return 'past_due';
  return 'canceled';
}

/**
 * Rede de segurança pro caso do webhook do Mercado Pago não chegar (já
 * observado no sandbox deles). Consulta o status real da assinatura direto
 * na API sempre que o nosso banco ainda não está num estado final.
 */
export async function reconcileMercadoPagoSubscription(userId: string, log?: { error: (obj: unknown, msg?: string) => void }) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      provider: 'mercado_pago',
      // 'active' também não é final - um cartão recusado na renovação cancela
      // a assinatura na Mercado Pago, e se o webhook desse evento se perder
      // (já observado no sandbox deles), só reconciliar trialing/past_due
      // nunca detectaria isso e o usuário ficaria com acesso pago pra sempre.
      status: { in: ['trialing', 'past_due', 'active'] },
      providerSubscriptionId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!subscription?.providerSubscriptionId) return;

  // Assinatura ativa com data de renovação ainda no futuro não precisa
  // consultar a Mercado Pago de novo - evita bater na API deles a cada
  // /auth/me só pra confirmar o que já sabemos que está certo.
  const periodEndIsFresh =
    subscription.status === 'active' &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd.getTime() > Date.now();
  if (periodEndIsFresh) return;

  try {
    const preapproval = await getPreapproval(subscription.providerSubscriptionId);
    const status = mapMercadoPagoStatus(preapproval.status);
    // A cada renovação de cartão a Mercado Pago não manda um webhook novo (o
    // preapproval continua 'authorized') - sem atualizar isso aqui também,
    // currentPeriodEnd travava pra sempre na data do fim do trial (ou nulo,
    // pra quem nunca teve trial), e o upgrade/downgrade de plano anual nunca
    // conseguia saber até quando o cartão já estava pago.
    const nextPeriodEnd = preapproval.next_payment_date ? new Date(preapproval.next_payment_date) : undefined;

    const statusChanged = status !== null && status !== subscription.status;
    const periodChanged =
      nextPeriodEnd !== undefined && nextPeriodEnd.getTime() !== (subscription.currentPeriodEnd?.getTime() ?? -1);
    if (!statusChanged && !periodChanged) return;

    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: subscription.id },
        data: { ...(statusChanged ? { status: status! } : {}), ...(periodChanged ? { currentPeriodEnd: nextPeriodEnd } : {}) },
      }),
      ...(statusChanged ? [prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: status! } })] : []),
    ]);
  } catch (err) {
    // Falha na consulta não deve quebrar a tela do usuário - tenta de novo na
    // próxima chamada. Mas precisa ficar visível: sem log aqui, um token de
    // acesso expirado ou uma falha permanente na Mercado Pago passaria
    // despercebido pra sempre, disfarçado de "falha transitória".
    log?.error({ userId, err }, 'Falha ao reconciliar assinatura com a Mercado Pago');
  }
}

/**
 * Mesma rede de segurança que reconcileMercadoPagoSubscription, pra HyperCash -
 * não há razão pra assumir que o webhook dela nunca vai se perder (a da
 * Mercado Pago já perdeu, ao vivo, mais de uma vez nesta sessão).
 * providerSubscriptionId guarda o id do PAYMENT-LINK (estável desde a
 * criação, nunca trocado) - resolve a assinatura de verdade pelo filtro
 * paymentLinkId sempre que precisa (ver getSubscriptionByPaymentLinkId).
 */
export async function reconcileHypercashSubscription(userId: string, log?: { error: (obj: unknown, msg?: string) => void }) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      provider: 'hypercash',
      status: { in: ['past_due', 'active'] },
      providerSubscriptionId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!subscription?.providerSubscriptionId) return;

  const periodEndIsFresh =
    subscription.status === 'active' &&
    subscription.currentPeriodEnd !== null &&
    subscription.currentPeriodEnd.getTime() > Date.now();
  if (periodEndIsFresh) return;

  try {
    const hcSubscription = await getSubscriptionByPaymentLinkId(subscription.providerSubscriptionId);
    // Ainda não existe assinatura de verdade (ninguém pagou esse link ainda) -
    // nada pra reconciliar, não é erro.
    if (!hcSubscription) return;

    const status = mapHypercashStatus(hcSubscription.status);
    const nextPeriodEnd = hcSubscription.currentPeriodEnd ? new Date(hcSubscription.currentPeriodEnd) : undefined;

    const statusChanged = status !== subscription.status;
    const periodChanged =
      nextPeriodEnd !== undefined && nextPeriodEnd.getTime() !== (subscription.currentPeriodEnd?.getTime() ?? -1);
    if (!statusChanged && !periodChanged) return;

    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: subscription.id },
        data: { ...(statusChanged ? { status } : {}), ...(periodChanged ? { currentPeriodEnd: nextPeriodEnd } : {}) },
      }),
      ...(statusChanged ? [prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: status } })] : []),
    ]);
  } catch (err) {
    log?.error({ userId, err }, 'Falha ao reconciliar assinatura com a HyperCash');
  }
}
