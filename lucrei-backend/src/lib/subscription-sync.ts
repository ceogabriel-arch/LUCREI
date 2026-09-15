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

  try {
    const preapproval = await getPreapproval(subscription.providerSubscriptionId);
    const status = mapMercadoPagoStatus(preapproval.status);
    if (!status || status === subscription.status) return;

    await prisma.$transaction([
      prisma.subscription.update({ where: { id: subscription.id }, data: { status } }),
      prisma.user.update({ where: { id: userId }, data: { subscriptionStatus: status } }),
    ]);
  } catch (err) {
    // Falha na consulta não deve quebrar a tela do usuário - tenta de novo na
    // próxima chamada. Mas precisa ficar visível: sem log aqui, um token de
    // acesso expirado ou uma falha permanente na Mercado Pago passaria
    // despercebido pra sempre, disfarçado de "falha transitória".
    log?.error({ userId, err }, 'Falha ao reconciliar assinatura com a Mercado Pago');
  }
}
