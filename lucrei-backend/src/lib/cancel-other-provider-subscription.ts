import type { FastifyInstance } from 'fastify';

import * as mercadopago from '../mercadopago-client';
import { prisma } from './prisma';

/**
 * Trocar de método de pagamento (cartão <-> Pix) só devia deixar uma
 * assinatura ativa por vez - sem isso, a antiga continua cobrando sozinha
 * (o cartão renova automático, o Pix gera um novo ciclo sempre que a tela de
 * planos é aberta) enquanto a nova também cobra, dobrando o valor pago.
 */
export async function cancelOtherProviderSubscription(
  app: FastifyInstance,
  userId: string,
  keepProvider: 'mercado_pago' | 'mercado_pago_pix'
) {
  const otherProvider = keepProvider === 'mercado_pago' ? 'mercado_pago_pix' : 'mercado_pago';
  const existing = await prisma.subscription.findFirst({
    where: { userId, provider: otherProvider, status: { not: 'canceled' } },
    orderBy: { createdAt: 'desc' },
  });
  if (!existing) return;

  if (existing.provider === 'mercado_pago' && existing.providerSubscriptionId) {
    try {
      await mercadopago.cancelPreapproval(existing.providerSubscriptionId);
    } catch (err) {
      app.log.error(err);
    }
  }
  await prisma.subscription.update({ where: { id: existing.id }, data: { status: 'canceled' } });
}
