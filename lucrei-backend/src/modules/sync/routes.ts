import type { FastifyInstance } from 'fastify';

import { checkSalesLimitBlock, getSalesLimitStatus } from '../../lib/sales-usage';
import { checkSubscriptionAccessBlock } from '../../lib/subscription-access';
import { startOfCurrentMonth } from '../../lib/period';
import { prisma } from '../../lib/prisma';
import { sendPushNotification } from '../../lib/push-notifications';
import { runHistoryBackfill, runShopSync, WINDOW_SECONDS } from './service';

// Avisa a conta quando ela cruza esse percentual do limite mensal do plano,
// uma vez por mês, pra dar tempo de fazer upgrade antes do bloqueio total em 100%.
const WARNING_THRESHOLD = 0.8;

// Backfill de histórico (botão em Relatórios) não vai além de 1 ano pra
// trás - a API da Shopee tem um limite prático de retenção de pedidos
// antigos, e ir além disso só deixaria o backfill ainda mais lento sem
// trazer dado a mais.
const HISTORY_BACKFILL_DAYS = 365;

// Total de blocos de 15 dias que o backfill percorre - fixo, dá pra calcular
// sem rodar nada, então vira a barra de progresso no app (windowsDone /
// windowsTotal), diferente da contagem de pedidos que varia com quanto cada
// loja vendeu em cada bloco.
const HISTORY_BACKFILL_WINDOWS_TOTAL = Math.ceil((HISTORY_BACKFILL_DAYS * 24 * 60 * 60) / WINDOW_SECONDS);

// startedAt funciona como "último sinal de vida" pro backfill (reescrito a
// cada bloco de 15 dias processado - ver runHistoryBackfill em service.ts);
// pro sync normal (uma janela só) é só o início mesmo. Cada bloco tem teto
// de 10min (WINDOW_TIMEOUT_MS), então o intervalo entre dois sinais de vida
// nunca deveria passar disso - 15min de folga cobre esse teto e trata como
// travado só quando não sobrou nenhuma dúvida (processo reiniciado no meio,
// por exemplo). Tanto o GET (solta o app do polling e reabilita o botão)
// quanto o POST (deixa começar de novo) usam esse corte, pros dois status.
const STALE_RUNNING_MS = 15 * 60 * 1000;

function isRunStale(status: string | null, startedAt: Date | null) {
  return status === 'running' && startedAt != null && Date.now() - startedAt.getTime() > STALE_RUNNING_MS;
}

export async function syncRoutes(app: FastifyInstance) {
  // Dispara o sync e devolve na hora, em vez de segurar a requisição até
  // terminar - com muitos usuários sincronizando ao mesmo tempo (ou uma loja
  // de alto volume), travar a requisição inteira é o que mais pesa num
  // único processo. O app acompanha via GET abaixo, igual ao backfill.
  app.post<{ Params: { shopId: string } }>(
    '/shops/:shopId/sync',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) {
        return reply.status(404).send({ message: 'Loja não encontrada.' });
      }

      if (shop.syncStatus === 'running' && !isRunStale(shop.syncStatus, shop.syncStartedAt)) {
        return reply.send({ status: 'running', ordersSynced: shop.syncOrdersSynced ?? 0 });
      }

      const user = await prisma.user.findUnique({
        where: { id: request.user.sub },
        include: { plan: true },
      });

      const subscriptionBlock = await checkSubscriptionAccessBlock(request.user.sub);
      if (subscriptionBlock.blocked) {
        return reply.status(403).send({ message: subscriptionBlock.message, code: 'subscription_past_due' });
      }

      if (user?.plan?.salesLimit != null) {
        const status = await getSalesLimitStatus(user);

        if (status.overLimit) {
          const block = await checkSalesLimitBlock(user.id);
          if (block.blocked) {
            return reply.status(403).send({ message: block.message, code: 'sales_limit_reached' });
          }
        } else {
          const alreadyWarnedThisMonth =
            user.salesLimitWarnedAt != null && user.salesLimitWarnedAt >= startOfCurrentMonth();
          if (!alreadyWarnedThisMonth && status.ordersThisMonth >= user.plan.salesLimit * WARNING_THRESHOLD) {
            await prisma.user.update({ where: { id: user.id }, data: { salesLimitWarnedAt: new Date() } });
            if (user.pushToken) {
              await sendPushNotification(
                user.pushToken,
                'Quase no limite do plano ⚠️',
                `Você já usou ${status.ordersThisMonth} das ${user.plan.salesLimit} vendas do plano ${user.plan.name} esse mês. Considere fazer upgrade pra não travar a sincronização.`
              ).catch((err) => app.log.error(err));
            }
          }
        }
      }

      runShopSync(shop.id).catch((err) => app.log.error(err));

      return reply.send({ status: 'running', ordersSynced: 0 });
    }
  );

  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/sync',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
        select: { syncStatus: true, syncStartedAt: true, syncOrdersSynced: true, syncError: true },
      });
      if (!shop) {
        return reply.status(404).send({ message: 'Loja não encontrada.' });
      }

      if (isRunStale(shop.syncStatus, shop.syncStartedAt)) {
        return reply.send({
          status: 'error',
          ordersSynced: shop.syncOrdersSynced ?? 0,
          error: 'A sincronização ficou parada por muito tempo e foi interrompida. Tente de novo.',
        });
      }

      return reply.send({
        status: shop.syncStatus ?? 'idle',
        ordersSynced: shop.syncOrdersSynced ?? 0,
        error: shop.syncError,
      });
    }
  );

  // Dispara o backfill e devolve na hora - uma loja com bastante histórico
  // facilmente passa de 1 minuto no total (múltiplas janelas de 15 dias,
  // cada uma com várias chamadas à Shopee), tempo demais pra segurar numa
  // única requisição sem esbarrar em timeout de proxy/navegador. O app
  // acompanha via GET .../backfill abaixo.
  // "backfill" em vez de ".../sync/history": bloqueadores de anúncio/rastreio
  // (uBlock, AdBlock etc.) usam listas que barram qualquer URL com "/sync/"
  // no caminho, porque empresas de ad-tech usam esse padrão pra sincronizar
  // cookies entre sites - isso derrubava esse endpoint (com poll a cada 4s,
  // por minutos, ele aparecia MUITO mais que qualquer outra chamada da
  // página, então o efeito ficava concentrado só aqui).
  app.post<{ Params: { shopId: string } }>(
    '/shops/:shopId/backfill',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) {
        return reply.status(404).send({ message: 'Loja não encontrada.' });
      }

      const isStale = isRunStale(shop.historyBackfillStatus, shop.historyBackfillStartedAt);

      if (shop.historyBackfillStatus === 'running' && !isStale) {
        return reply.send({
          status: 'running',
          ordersSynced: shop.historyBackfillSynced ?? 0,
          windowsDone: shop.historyBackfillWindowsDone ?? 0,
          windowsTotal: HISTORY_BACKFILL_WINDOWS_TOTAL,
        });
      }

      const subscriptionBlock = await checkSubscriptionAccessBlock(request.user.sub);
      if (subscriptionBlock.blocked) {
        return reply.status(403).send({ message: subscriptionBlock.message, code: 'subscription_past_due' });
      }

      const block = await checkSalesLimitBlock(request.user.sub);
      if (block.blocked) {
        return reply.status(403).send({ message: block.message, code: 'sales_limit_reached' });
      }

      const since = new Date(Date.now() - HISTORY_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
      runHistoryBackfill(shop.id, since).catch((err) => app.log.error(err));

      return reply.send({ status: 'running', ordersSynced: 0, windowsDone: 0, windowsTotal: HISTORY_BACKFILL_WINDOWS_TOTAL });
    }
  );

  app.get<{ Params: { shopId: string } }>(
    '/shops/:shopId/backfill',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
        select: {
          historyBackfillStatus: true,
          historyBackfillStartedAt: true,
          historyBackfillSynced: true,
          historyBackfillWindowsDone: true,
          historyBackfillError: true,
        },
      });
      if (!shop) {
        return reply.status(404).send({ message: 'Loja não encontrada.' });
      }

      // Sem isso, um backfill travado (processo reiniciado no meio, etc.)
      // deixava o app achando "ainda tá rodando" pra sempre - reabre o
      // botão em vez de ficar preso acompanhando algo que não existe mais.
      if (isRunStale(shop.historyBackfillStatus, shop.historyBackfillStartedAt)) {
        return reply.send({
          status: 'error',
          ordersSynced: shop.historyBackfillSynced ?? 0,
          windowsDone: shop.historyBackfillWindowsDone ?? 0,
          windowsTotal: HISTORY_BACKFILL_WINDOWS_TOTAL,
          error: 'A sincronização ficou parada por muito tempo e foi interrompida. Tente de novo.',
        });
      }

      return reply.send({
        status: shop.historyBackfillStatus ?? 'idle',
        ordersSynced: shop.historyBackfillSynced ?? 0,
        windowsDone: shop.historyBackfillWindowsDone ?? 0,
        windowsTotal: HISTORY_BACKFILL_WINDOWS_TOTAL,
        error: shop.historyBackfillError,
      });
    }
  );
}
