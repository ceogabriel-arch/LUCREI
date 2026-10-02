import type { Plan, User } from '@prisma/client';

import { prisma } from './prisma';
import { formatBRL, sendPushNotification } from './push-notifications';
import { getSalesLimitStatus } from './sales-usage';
import { getSubscriptionAccessStatus } from './subscription-access';

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
// faturamento entra no corpo como contexto do tamanho do pedido. O
// marketplace abreviado vai no título pra quem tem loja Shopee e Mercado
// Livre ao mesmo tempo saber de onde veio sem abrir o app.
// Nomes dos arquivos de som customizado empacotados pelo plugin
// expo-notifications (ver app.json) - só tocam no app nativo depois de um
// build novo, a web ignora esse campo sem erro.
const SOUND_PROFIT = 'lu-crei.wav';
const SOUND_LOSS = 'alerta-prejuizo.wav';

function buildNotificationMessage(
  totalProfit: number | null,
  totalRevenue: number,
  marketplaceLabel: string,
): { title: string; body: string; sound: string } {
  const revenueText = formatBRL(totalRevenue);
  if (totalProfit === null) {
    return {
      title: `Pedido concluído (${marketplaceLabel})`,
      body: `Pedido de ${revenueText} - cadastre o custo do produto pra saber quanto você lucrou nele.`,
      sound: SOUND_PROFIT,
    };
  }
  // Margem sobre o faturamento do pedido - só faz sentido com faturamento
  // positivo (evita divisão por zero/sinal estranho num pedido de valor 0).
  const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
  const marginText = `${marginPct.toFixed(1)}%`;

  if (totalProfit < 0) {
    return {
      title: `Prejuízo de ${formatBRL(Math.abs(totalProfit))} (${marketplaceLabel})`,
      body: `Pedido de ${revenueText} (${marginText}) - esse aqui fechou no prejuízo, vale dar uma olhada.`,
      sound: SOUND_LOSS,
    };
  }
  return {
    title: `Lucro de ${formatBRL(totalProfit)} (${marketplaceLabel})`,
    body: `Pedido de ${revenueText} - lucro líquido de ${marginText} já calculado, na hora.`,
    sound: SOUND_PROFIT,
  };
}

// Conta sem acesso (pagamento atrasado além da carência, limite de vendas
// estourado além da carência, ou teste grátis vencido) não devia continuar
// recebendo "você lucrou R$X" - a pessoa nem consegue ver os dados reais (
// ficam borrados no app), a notificação só confunde. O teste grátis é o caso
// mais sutil: subscriptionStatus só vira 'past_due' de fato na próxima vez
// que o app abre a tela de fatura (ver ensureCurrentPixCharge) - sem checar
// trialEndsAt aqui direto, quem nunca abre aquela tela depois do teste
// acabar continuaria "trialing" pro resto da vida e recebendo notificação.
async function isAccountNotifiable(owner: User & { plan: Plan | null }): Promise<boolean> {
  if (owner.subscriptionStatus === 'trialing' && owner.trialEndsAt && owner.trialEndsAt <= new Date()) {
    return false;
  }

  const subscriptionAccess = await getSubscriptionAccessStatus(owner);
  if (subscriptionAccess.blocked) return false;

  const salesLimit = await getSalesLimitStatus(owner);
  if (salesLimit.blocked) return false;

  return true;
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

  const shop = await prisma.shop.findUnique({ where: { id: params.shopDbId } });
  if (!shop) return;

  const owner = await prisma.user.findUnique({ where: { id: shop.userId }, include: { plan: true } });
  if (!owner?.pushToken) return;

  // Checado ANTES de reservar o pedido (não depois) - deixando notifiedAt
  // null enquanto a conta estiver sem acesso, se ela for regularizada dentro
  // da janela de FALLBACK_WINDOW_MS acima, a próxima sincronização tenta de
  // novo e a notificação (atrasada) ainda chega. Passada a janela, fica sem
  // notificar mesmo - é só rede de segurança pra pedido recente, não um jeito
  // de notificar tudo retroativamente depois de reativar a conta.
  if (!(await isAccountNotifiable(owner))) return;

  // updateMany com notifiedAt: null como condição é o que garante mandar UMA
  // notificação só - o webhook e a sincronização normal podem chegar aqui
  // quase ao mesmo tempo pro mesmo pedido, só o primeiro que "ganha" a
  // corrida consegue marcar e seguir adiante.
  const claimed = await prisma.order.updateMany({
    where: { id: params.orderId, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  if (claimed.count === 0) return;

  const marketplaceLabel = shop.provider === 'mercado_livre' ? 'ML' : 'Shopee';
  const { title, body, sound } = buildNotificationMessage(params.totalProfit, params.totalRevenue, marketplaceLabel);

  try {
    await sendPushNotification(owner.pushToken, title, body, { orderSn: params.orderSn }, sound);
  } catch (err) {
    // O pedido foi "reservado" acima antes de mandar de verdade, pra dois
    // processos concorrentes (webhook + sync) não mandarem a mesma
    // notificação em dobro. Mas se o ENVIO em si falhar (token inválido,
    // Expo fora do ar), reverte a marca - senão o pedido fica etiquetado
    // como "já notificado" pra sempre, sem a notificação nunca ter chegado
    // de verdade, e nenhuma sincronização futura tenta de novo.
    // console.error (não app.log - esse módulo não tem acesso à instância do
    // Fastify) ainda assim aparece nos logs do Railway, que capturam
    // stdout/stderr do processo inteiro - sem isso, uma falha de envio ficava
    // muda: o pedido só parecia "sincronizado sem notificar", sem pista
    // nenhuma do motivo real.
    console.error(`[order-notifications] Falha ao enviar push do pedido ${params.orderSn}:`, err);
    await prisma.order.updateMany({ where: { id: params.orderId, notifiedAt: { not: null } }, data: { notifiedAt: null } });
    throw err;
  }
}
