import { prisma } from './prisma';
import { formatBRL, sendPushNotification } from './push-notifications';

// O push de status de pedido da Shopee não tem entrega garantida - a
// sincronização normal (roda de qualquer forma, a cada poucos minutos)
// também chama isso, pra pegar o que o webhook não avisou. O guard de tempo
// evita mandar notificação de pedido velho quando alguém reconecta uma loja
// ou roda backfill de histórico - isso é só rede de segurança pra pedido
// recente, não um jeito de notificar tudo retroativamente.
const FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;

// O lucro vai no título (é a informação que importa de verdade, olhando de
// relance, e é o que só o Lucrei mostra - a Shopee só expõe o faturamento
// bruto) - "Você lucrou -R$ 5,00 nesse pedido" não fazia sentido nenhum num
// pedido que deu prejuízo, então trata os três casos separados. O
// faturamento entra no corpo como contexto do tamanho do pedido.
function buildNotificationMessage(totalProfit: number | null, totalRevenue: number): { title: string; body: string } {
  const revenueText = formatBRL(totalRevenue);
  if (totalProfit === null) {
    return {
      title: 'Pedido concluído',
      body: `Pedido de ${revenueText} - cadastre o custo do produto pra saber quanto você lucrou nele.`,
    };
  }
  if (totalProfit < 0) {
    return {
      title: `⚠️ Prejuízo de ${formatBRL(Math.abs(totalProfit))}`,
      body: `Pedido de ${revenueText} - esse aqui fechou no prejuízo, vale dar uma olhada.`,
    };
  }
  return {
    title: `💰 Lucro de ${formatBRL(totalProfit)}`,
    body: `Pedido de ${revenueText} - lucro líquido já calculado, na hora.`,
  };
}

export async function notifyOrderCompletedIfNeeded(params: {
  orderId: string;
  orderSn: string;
  shopDbId: string;
  completedAt: Date | null;
  totalProfit: number | null;
  totalRevenue: number;
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

  const { title, body } = buildNotificationMessage(params.totalProfit, params.totalRevenue);

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
