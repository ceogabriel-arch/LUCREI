import type { FastifyInstance } from 'fastify';

import { getSalesLimitStatus } from '../../lib/sales-usage';
import { startOfCurrentMonth } from '../../lib/period';
import { prisma } from '../../lib/prisma';
import { sendPushNotification } from '../../lib/push-notifications';
import { syncShopOrders } from './service';

// Avisa a conta quando ela cruza esse percentual do limite mensal do plano,
// uma vez por mês, pra dar tempo de fazer upgrade antes do bloqueio total em 100%.
const WARNING_THRESHOLD = 0.8;

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
          if (status.blocked) {
            return reply.status(403).send({
              message: `Seu plano ${user.plan.name} permite até ${user.plan.salesLimit} vendas/mês e o prazo de carência já acabou. Faça upgrade pra continuar sincronizando pedidos.`,
              code: 'sales_limit_reached',
            });
          }
          // Dentro da carência (ou acabou de bater o limite agora) - grava
          // quando começou, se ainda não tinha, e segue pro sync normal.
          if (!user.salesLimitReachedAt || user.salesLimitReachedAt < startOfCurrentMonth()) {
            await prisma.user.update({ where: { id: user.id }, data: { salesLimitReachedAt: new Date() } });
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
}
