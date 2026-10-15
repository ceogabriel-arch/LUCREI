import type { FastifyInstance } from 'fastify';

import * as mercadopago from '../mercadopago-client';
import { prisma } from './prisma';

/**
 * Rede de segurança pra quem ainda tinha uma assinatura presa na Mercado
 * Pago de antes da migração pra HyperCash (ver conversa) - sem isso, ela
 * continuaria cobrando sozinha (cartão renova automático) ao mesmo tempo
 * que a assinatura nova na HyperCash também cobra. Não deveria mais
 * acontecer de verdade (nenhuma assinatura mercado_pago/mercado_pago_pix
 * ativa no banco na data da migração), mas custa pouco manter como
 * segurança pra conta antiga que reapareça.
 *
 * Lança se a assinatura antiga era por cartão e a Mercado Pago recusar
 * cancelar de verdade - propositalmente barulhento, porque marcar como
 * cancelado no nosso banco sem o cartão ter sido cancelado de verdade
 * recria o exato problema de cobrança dupla que essa função existe pra
 * evitar (a chamadora deve devolver um erro pro usuário tentar de novo, em
 * vez de seguir criando uma assinatura nova por cima da zumbi).
 */
export async function cancelLegacyMercadoPagoSubscription(app: FastifyInstance, userId: string) {
  const legacy = await prisma.subscription.findMany({
    where: { userId, provider: { in: ['mercado_pago', 'mercado_pago_pix'] }, status: { not: 'canceled' } },
  });
  if (legacy.length === 0) return;

  for (const subscription of legacy) {
    if (subscription.provider === 'mercado_pago' && subscription.providerSubscriptionId) {
      try {
        await mercadopago.cancelPreapproval(subscription.providerSubscriptionId);
      } catch (err) {
        app.log.error(err);
        throw new Error('Não foi possível cancelar sua assinatura anterior na Mercado Pago.');
      }
    }
    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'canceled' } });
  }
}
