import type { FastifyBaseLogger } from 'fastify';

import { deactivatePaymentLink } from '../hypercash-client';
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
  subscription: { provider: string; status: string; providerSubscriptionId: string | null; updatedAt: Date },
  now = Date.now()
): boolean {
  if (subscription.provider !== 'hypercash') return false;
  if (subscription.status !== 'past_due') return false;
  if (!subscription.providerSubscriptionId) return false;
  return now - subscription.updatedAt.getTime() > PENDING_CHECKOUT_EXPIRY_HOURS * 60 * 60 * 1000;
}

// Desativa o link na HyperCash (ninguém mais consegue pagar por ele) e limpa
// a referência local - a próxima vez que a pessoa tentar pagar
// (/plans/select reaproveitando ou gerando de novo, ver needsNewLink),
// ganha um link novo com o preço atual, em vez de reabrir o antigo.
export async function expireStaleCheckouts(logger?: FastifyBaseLogger): Promise<number> {
  const now = Date.now();
  const candidates = await prisma.subscription.findMany({
    where: {
      provider: 'hypercash',
      status: 'past_due',
      providerSubscriptionId: { not: null },
      updatedAt: { lt: new Date(now - PENDING_CHECKOUT_EXPIRY_HOURS * 60 * 60 * 1000) },
    },
  });

  let expired = 0;
  for (const subscription of candidates) {
    if (!isCheckoutStale(subscription, now)) continue;

    try {
      await deactivatePaymentLink(subscription.providerSubscriptionId!);
    } catch (err) {
      // Falha ao desativar na HyperCash não deve travar a limpeza local -
      // loga e segue (o link pode já ter sido pago/cancelado manualmente
      // enquanto isso, por exemplo).
      logger?.error({ err, subscriptionId: subscription.id }, 'watchdog: falha ao desativar link de pagamento expirado na HyperCash');
    }

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { providerSubscriptionId: null, lastInvoiceUrl: null },
    });
    expired++;
    logger?.warn({ subscriptionId: subscription.id }, 'watchdog: link de pagamento pendente expirado (24h sem confirmação)');
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
