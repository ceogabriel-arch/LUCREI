import type { FastifyInstance } from 'fastify';

import { checkSalesLimitBlock, getSalesLimitStatus } from '../../lib/sales-usage';
import { startOfCurrentMonth } from '../../lib/period';
import { prisma } from '../../lib/prisma';
import { sendPushNotification } from '../../lib/push-notifications';
import { runHistoryBackfill, syncShopOrders } from './service';

// Avisa a conta quando ela cruza esse percentual do limite mensal do plano,
// uma vez por mês, pra dar tempo de fazer upgrade antes do bloqueio total em 100%.
const WARNING_THRESHOLD = 0.8;

// Backfill de histórico (botão em Relatórios) não vai além de 1 ano pra
// trás - a API da Shopee tem um limite prático de retenção de pedidos
// antigos, e ir além disso só deixaria o backfill ainda mais lento sem
// trazer dado a mais.
const HISTORY_BACKFILL_DAYS = 365;

// Cada bloco de 15 dias tem teto de tempo (ver WINDOW_TIMEOUT_MS em
// service.ts), então em condições normais "running" nunca fica parado por
// mais que alguns minutos. Se mesmo assim continuar "running" por muito
// tempo (processo reiniciado no meio de um backfill, por exemplo), trata
// como travado - tanto o GET (pra soltar o app do polling e reabilitar o
// botão) quanto o POST (pra deixar começar de novo) usam esse mesmo corte.
const STALE_RUNNING_MS = 20 * 60 * 1000;

function isBackfillStale(status: string | null, startedAt: Date | null) {
  return status === 'running' && startedAt != null && Date.now() - startedAt.getTime() > STALE_RUNNING_MS;
}

export async function syncRoutes(app: FastifyInstance) {
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

      const user = await prisma.user.findUnique({
        where: { id: request.user.sub },
        include: { plan: true },
      });

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

      try {
        const result = await syncShopOrders(shop.id);
        return result;
      } catch (err) {
        app.log.error(err);
        return reply.status(502).send({ message: 'Falha ao sincronizar pedidos com a Shopee.' });
      }
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

      const isStale = isBackfillStale(shop.historyBackfillStatus, shop.historyBackfillStartedAt);

      if (shop.historyBackfillStatus === 'running' && !isStale) {
        return reply.send({ status: 'running', ordersSynced: shop.historyBackfillSynced ?? 0 });
      }

      const block = await checkSalesLimitBlock(request.user.sub);
      if (block.blocked) {
        return reply.status(403).send({ message: block.message, code: 'sales_limit_reached' });
      }

      const since = new Date(Date.now() - HISTORY_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
      runHistoryBackfill(shop.id, since).catch((err) => app.log.error(err));

      return reply.send({ status: 'running', ordersSynced: 0 });
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
          historyBackfillError: true,
        },
      });
      if (!shop) {
        return reply.status(404).send({ message: 'Loja não encontrada.' });
      }

      // Sem isso, um backfill travado (processo reiniciado no meio, etc.)
      // deixava o app achando "ainda tá rodando" pra sempre - reabre o
      // botão em vez de ficar preso acompanhando algo que não existe mais.
      if (isBackfillStale(shop.historyBackfillStatus, shop.historyBackfillStartedAt)) {
        return reply.send({
          status: 'error',
          ordersSynced: shop.historyBackfillSynced ?? 0,
          error: 'A sincronização ficou parada por muito tempo e foi interrompida. Tente de novo.',
        });
      }

      return reply.send({
        status: shop.historyBackfillStatus ?? 'idle',
        ordersSynced: shop.historyBackfillSynced ?? 0,
        error: shop.historyBackfillError,
      });
    }
  );
}
