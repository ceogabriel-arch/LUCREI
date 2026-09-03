import { prisma } from './prisma';
import { getPreapproval } from '../mercadopago-client';

export function mapMercadoPagoStatus(mpStatus: string): 'active' | 'past_due' | 'canceled' | null {
  if (mpStatus === 'authorized') return 'active';
  if (mpStatus === 'paused') return 'past_due';
  if (mpStatus === 'cancelled') return 'canceled';
  return null;
}

/**
 * Rede de segurança pro caso do webhook do Mercado Pago não chegar (já
 * observado no sandbox deles). Consulta o status real da assinatura direto
 * na API sempre que o nosso banco ainda não está num estado final.
 */
export async function reconcileMercadoPagoSubscription(userId: string) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      userId,
      provider: 'mercado_pago',
      status: { in: ['trialing', 'past_due'] },
      providerSubscriptionId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!subscription?.providerSubscriptionId) return;

  try {
    const preapproval = await getPreapproval(subscription.providerSubscriptionId);
    const status = mapMercadoPagoStatus(preapproval.status);
    if (!status || status === subscription.status) return;

    await prisma.subscription.update({ where: { id: subscription.id }, data: { status } });
    await prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: status } });
  } catch {
    // Falha na consulta não deve quebrar a tela do usuário — tenta de novo na próxima chamada.
  }
}
