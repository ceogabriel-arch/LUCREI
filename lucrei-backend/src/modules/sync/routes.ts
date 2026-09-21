import type { FastifyInstance } from 'fastify';

import { checkSalesLimitBlock, getSalesLimitStatus } from '../../lib/sales-usage';
import { startOfCurrentMonth } from '../../lib/period';
import { prisma } from '../../lib/prisma';
import { sendPushNotification } from '../../lib/push-notifications';
import { syncShopOrders, syncShopOrdersHistory } from './service';

// Avisa a conta quando ela cruza esse percentual do limite mensal do plano,
// uma vez por mês, pra dar tempo de fazer upgrade antes do bloqueio total em 100%.
const WARNING_THRESHOLD = 0.8;

// Backfill de histórico (botão em Relatórios) não vai além de 1 ano pra
// trás - a API da Shopee tem um limite prático de retenção de pedidos
// antigos, e ir além disso só deixaria o backfill ainda mais lento sem
// trazer dado a mais.
const HISTORY_BACKFILL_DAYS = 365;

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

  app.post<{ Params: { shopId: string } }>(
    '/shops/:shopId/sync/history',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) {
        return reply.status(404).send({ message: 'Loja não encontrada.' });
      }

      const block = await checkSalesLimitBlock(request.user.sub);
      if (block.blocked) {
        return reply.status(403).send({ message: block.message, code: 'sales_limit_reached' });
      }

      try {
        const since = new Date(Date.now() - HISTORY_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
        const result = await syncShopOrdersHistory(shop.id, since);
        return result;
      } catch (err) {
        app.log.error(err);
        return reply.status(502).send({ message: 'Falha ao buscar o histórico de pedidos na Shopee.' });
      }
    }
  );
}
