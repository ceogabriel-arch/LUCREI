import { isAccountNotifiable } from './notification-access';
import { rangeStart } from './period';
import { prisma } from './prisma';
import { formatBRL, sendPushNotification } from './push-notifications';
import { computeShopSummary } from '../modules/summary/routes';

// Mesmo som de "lucro" da notificação de pedido - bater a meta é sempre boa
// notícia, nunca faz sentido tocar o som de prejuízo aqui.
const SOUND_GOAL_REACHED = 'lu_crei.wav';

// Chamado depois de QUALQUER pedido completar (Shopee ou Mercado Livre) -
// soma o lucro de hoje em todas as lojas da conta e compara com a meta
// diária configurada em Configurações. dailyGoalNotifiedAt garante só uma
// notificação por dia, mesmo com vários pedidos completando em sequência.
export async function checkDailyGoalReached(shopDbId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopDbId } });
  if (!shop) return;

  const owner = await prisma.user.findUnique({ where: { id: shop.userId }, include: { plan: true } });
  if (!owner?.pushToken || !owner.dailyProfitGoal) return;

  const todayStart = rangeStart('today');
  if (owner.dailyGoalNotifiedAt && owner.dailyGoalNotifiedAt >= todayStart) return;

  if (!(await isAccountNotifiable(owner))) return;

  const shops = await prisma.shop.findMany({ where: { userId: owner.id, status: 'active' } });
  if (shops.length === 0) return;

  const summaries = await Promise.all(shops.map((s) => computeShopSummary(s, { period: 'today' })));
  const totalProfitToday = summaries.reduce((sum, s) => sum + s.profit, 0);

  if (totalProfitToday < Number(owner.dailyProfitGoal)) return;

  // Mesmo padrão de reserva-antes-de-enviar do order-notifications: a
  // condição no WHERE garante que, se dois pedidos completarem quase juntos,
  // só o primeiro consegue "ganhar a corrida" e mandar a notificação.
  const claimed = await prisma.user.updateMany({
    where: { id: owner.id, OR: [{ dailyGoalNotifiedAt: null }, { dailyGoalNotifiedAt: { lt: todayStart } }] },
    data: { dailyGoalNotifiedAt: new Date() },
  });
  if (claimed.count === 0) return;

  try {
    await sendPushNotification(
      owner.pushToken,
      'Meta batida!',
      `Você lucrou ${formatBRL(totalProfitToday)} hoje. Bora pra cima.`,
      {},
      SOUND_GOAL_REACHED
    );
  } catch (err) {
    console.error(`[daily-goal-notifications] Falha ao enviar push de meta batida pro usuário ${owner.id}:`, err);
    await prisma.user.updateMany({ where: { id: owner.id, dailyGoalNotifiedAt: { not: null } }, data: { dailyGoalNotifiedAt: null } });
    throw err;
  }
}
