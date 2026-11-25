import type { FastifyBaseLogger } from 'fastify';

import { mapLimit } from './concurrency';
import { prisma } from './prisma';
import { reconcileFood99Fees } from '../modules/sync/food99-service';

// A comissão/repasse real da 99Food só é conhecida pela Financial API (Get
// Bill Data), consultada por período - não chega no pedido nem no webhook.
// Roda bem menos frequente que o polling da iFood (não é a única forma de
// saber de pedido novo, só de ajustar a taxa de um pedido que já existe).
const RUN_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4h
const CONCURRENCY = 3;

let running = false;

async function reconcileAllShops(log: FastifyBaseLogger) {
  if (running) return;
  running = true;
  try {
    const shops = await prisma.shop.findMany({
      where: { provider: 'food99', status: 'active', food99OAuthToken: { isNot: null } },
      select: { id: true },
    });

    await mapLimit(shops, CONCURRENCY, async (shop) => {
      try {
        await reconcileFood99Fees(shop.id);
      } catch (err) {
        log.error({ err, shopId: shop.id }, 'Falha na reconciliação financeira da 99Food.');
      }
    });
  } finally {
    running = false;
  }
}

export function startFood99FinancialWatchdog(log: FastifyBaseLogger): void {
  const run = () => {
    reconcileAllShops(log).catch((err) => log.error({ err }, 'Falha ao verificar lojas 99Food pra reconciliação financeira.'));
  };
  run();
  setInterval(run, RUN_INTERVAL_MS).unref();
}
