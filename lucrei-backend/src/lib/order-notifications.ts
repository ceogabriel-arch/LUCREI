import { prisma } from './prisma';
import { formatBRL, sendPushNotification } from './push-notifications';

// O push de status de pedido da Shopee não tem entrega garantida - a
// sincronização normal (roda de qualquer forma, a cada poucos minutos)
// também chama isso, pra pegar o que o webhook não avisou. O guard de tempo
// evita mandar notificação de pedido velho quando alguém reconecta uma loja
// ou roda backfill de histórico - isso é só rede de segurança pra pedido
// recente, não um jeito de notificar tudo retroativamente.
const FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function notifyOrderCompletedIfNeeded(params: {
  orderId: string;
  orderSn: string;
  shopDbId: string;
  completedAt: Date | null;
  totalProfit: number | null;
}) {
  if (!params.completedAt || Date.now() - params.completedAt.getTime() > FALLBACK_WINDOW_MS) {
    return;
  }

  // updateMany com notifiedAt: null como condição é o que garante mandar UMA
  // notificação só - o webhook e a sincronização normal podem chegar aqui
  // quase ao mesmo tempo pro mesmo pedido, só o primeiro que "ganha" a
  // corrida consegue marcar e seguir adiante.
  const claimed = await prisma.order.updateMany({
    where: { id: params.orderId, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  if (claimed.count === 0) return;

  const shop = await prisma.shop.findUnique({ where: { id: params.shopDbId } });
  if (!shop) return;

  const owner = await prisma.user.findUnique({ where: { id: shop.userId } });
  if (!owner?.pushToken) return;

  const title = 'Novo pedido concluído! 🎉';
  const body =
    params.totalProfit !== null
      ? `Você lucrou ${formatBRL(params.totalProfit)} nesse pedido.`
      : 'Cadastre o custo do produto pra ver o lucro desse pedido.';

  try {
    await sendPushNotification(owner.pushToken, title, body, { orderSn: params.orderSn });
  } catch (err) {
    // O pedido foi "reservado" acima antes de mandar de verdade, pra dois
    // processos concorrentes (webhook + sync) não mandarem a mesma
    // notificação em dobro. Mas se o ENVIO em si falhar (token inválido,
    // Expo fora do ar), reverte a marca - senão o pedido fica etiquetado
    // como "já notificado" pra sempre, sem a notificação nunca ter chegado
    // de verdade, e nenhuma sincronização futura tenta de novo.
    await prisma.order.updateMany({ where: { id: params.orderId, notifiedAt: { not: null } }, data: { notifiedAt: null } });
    throw err;
  }
}
