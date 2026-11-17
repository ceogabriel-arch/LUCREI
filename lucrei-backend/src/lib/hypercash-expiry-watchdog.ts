import type { FastifyBaseLogger } from 'fastify';

import { deactivatePaymentLink, getSubscriptionByPaymentLinkId } from '../hypercash-client';
import { prisma } from './prisma';

// 24h, igual o Pix da Mercado Pago (PIX_EXPIRATION_MINUTES) já usava - tempo
// suficiente pra alguém terminar de pagar sem pressa (achar o cartão,
// escanear o Pix), mas sem deixar um link de pagamento abandonado valendo
// pra sempre com o preço de quando foi gerado, caso o plano mude de valor
// depois. Só mexe em 'past_due' (cobrança de verdade pendente) - uma
// assinatura 'trialing' com um link gerado (pagando antes do prazo) nunca é
// tocada aqui, porque a pessoa ainda está dentro do próprio teste grátis,
// sem pressa nenhuma pra terminar de pagar.
export const PENDING_CHECKOUT_EXPIRY_HOURS = 24;

const WATCHDOG_INTERVAL_MS = 60 * 60 * 1000;

export function isCheckoutStale(
  subscription: {
    provider: string;
    status: string;
    providerSubscriptionId: string | null;
    lastInvoiceUrl?: string | null;
    updatedAt: Date;
  },
  now = Date.now()
): boolean {
  if (subscription.provider !== 'hypercash') return false;
  if (subscription.status !== 'past_due') return false;
  if (!subscription.providerSubscriptionId) return false;
  // Link já expirado antes (checkout limpo) - nada mais a expirar.
  if (subscription.lastInvoiceUrl === null) return false;
  return now - subscription.updatedAt.getTime() > PENDING_CHECKOUT_EXPIRY_HOURS * 60 * 60 * 1000;
}

// Desativa o link na HyperCash (ninguém mais consegue pagar por ele) e limpa
// o checkout local - a próxima vez que a pessoa tentar pagar
// (/plans/select reaproveitando ou gerando de novo, ver needsNewLink),
// ganha um link novo com o preço atual, em vez de reabrir o antigo.
//
// Só expira checkout que NUNCA foi pago. Antes expirava qualquer past_due
// com mais de 24h - incluindo assinatura de cartão de verdade que só caiu em
// past_due por uma renovação recusada (ver mapHypercashStatus): o link era
// desativado e providerSubscriptionId zerado, e o webhook de uma cobrança
// bem-sucedida depois (retentativa do cartão) não achava mais a assinatura
// e era ignorado - cliente cobrado e continuando bloqueado. Agora consulta a
// HyperCash: se já existe assinatura de verdade nesse link, não mexe. E
// providerSubscriptionId nunca é zerado aqui (só lastInvoiceUrl), pra
// qualquer webhook atrasado desse link continuar achando a assinatura.
export async function expireStaleCheckouts(logger?: FastifyBaseLogger): Promise<number> {
  const now = Date.now();
  const candidates = await prisma.subscription.findMany({
    where: {
      provider: 'hypercash',
      status: 'past_due',
      providerSubscriptionId: { not: null },
      lastInvoiceUrl: { not: null },
      updatedAt: { lt: new Date(now - PENDING_CHECKOUT_EXPIRY_HOURS * 60 * 60 * 1000) },
    },
  });

  let expired = 0;
  for (const subscription of candidates) {
    if (!isCheckoutStale(subscription, now)) continue;
    const linkId = subscription.providerSubscriptionId!;

    try {
      const hcSubscription = await getSubscriptionByPaymentLinkId(linkId);
      // Já teve pagamento de verdade (assinatura criada na HyperCash) -
      // é uma renovação atrasada, não um checkout abandonado.
      if (hcSubscription) continue;
    } catch (err) {
      // Sem como confirmar que nunca foi pago - na dúvida não expira (tenta
      // de novo na próxima rodada).
      logger?.error({ err, subscriptionId: subscription.id }, 'watchdog: falha ao consultar assinatura HyperCash do link pendente');
      continue;
    }

    try {
      await deactivatePaymentLink(linkId);
    } catch (err) {
      // Falha ao desativar na HyperCash não deve travar a limpeza local -
      // loga e segue (o link pode já ter sido pago/cancelado manualmente
      // enquanto isso, por exemplo).
      logger?.error({ err, subscriptionId: subscription.id }, 'watchdog: falha ao desativar link de pagamento expirado na HyperCash');
    }

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { lastInvoiceUrl: null },
    });
    expired++;
    logger?.warn(
      { subscriptionId: subscription.id, paymentLinkId: linkId },
      'watchdog: link de pagamento pendente expirado (24h sem confirmação)'
    );
  }

  return expired;
}

export function startHypercashExpiryWatchdog(logger: FastifyBaseLogger): void {
  const run = () => {
    expireStaleCheckouts(logger).catch((err) => {
      logger.error({ err }, 'watchdog: falha ao verificar links de pagamento pendentes');
    });
  };
  run();
  setInterval(run, WATCHDOG_INTERVAL_MS).unref();
}
