import type { FastifyBaseLogger } from 'fastify';

import { prisma } from './prisma';
import { pollShopEvents } from '../modules/sync/ifood-service';

// A iFood não empurra pedido (sem webhook/push, diferente de Shopee/ML) -
// precisa consultar o endpoint de eventos de cada loja periodicamente. Mais
// frequente que o shop-sync-watchdog (que só cobre loja "parada" há horas),
// porque aqui É o único jeito de saber de pedido novo.
const POLL_INTERVAL_MS = 30_000;

async function pollAllShops(log: FastifyBaseLogger) {
  const shops = await prisma.shop.findMany({
    where: { provider: 'ifood', status: 'active' },
    select: { id: true },
  });

  for (const shop of shops) {
    try {
      await pollShopEvents(shop.id);
    } catch (err) {
      log.error({ err, shopId: shop.id }, 'Falha no polling de eventos da iFood.');
    }
  }
}

export function startIfoodPollWatchdog(log: FastifyBaseLogger): void {
  const run = () => {
    pollAllShops(log).catch((err) => log.error({ err }, 'Falha ao verificar lojas iFood pra polling.'));
  };
  run();
  setInterval(run, POLL_INTERVAL_MS).unref();
}
