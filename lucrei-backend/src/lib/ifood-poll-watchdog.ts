import type { FastifyBaseLogger } from 'fastify';

import { mapLimit } from './concurrency';
import { prisma } from './prisma';
import { IFOOD_RECONNECT_MESSAGE, pollShopEvents } from '../modules/sync/ifood-service';

// A iFood não empurra pedido (sem webhook/push, diferente de Shopee/ML) -
// precisa consultar o endpoint de eventos de cada loja periodicamente. Mais
// frequente que o shop-sync-watchdog (que só cobre loja "parada" há horas),
// porque aqui É o único jeito de saber de pedido novo.
const POLL_INTERVAL_MS = 30_000;
// Várias lojas ao mesmo tempo - em sequência, uma loja lenta (15s de timeout
// por chamada) atrasava todas as outras e a rodada passava dos 30s.
const POLL_CONCURRENCY = 5;

let running = false;

async function pollAllShops(log: FastifyBaseLogger) {
  // Uma rodada lenta não pode sobrepor a próxima - duas rodadas buscavam os
  // mesmos eventos ainda não confirmados e processavam o mesmo pedido juntas.
  if (running) return;
  running = true;
  try {
    const shops = await prisma.shop.findMany({
      where: {
        provider: 'ifood',
        status: 'active',
        // Autorização revogada/vencida: insistir a cada 30s só gera erro -
        // fica parada até o lojista reconectar (que limpa o syncError).
        NOT: { syncError: IFOOD_RECONNECT_MESSAGE },
      },
      select: { id: true },
    });

    await mapLimit(shops, POLL_CONCURRENCY, async (shop) => {
      try {
        // Diferente de Shopee/ML/TikTok, conta bloqueada NÃO para de
        // consultar aqui: a iFood só guarda os eventos por tempo limitado e
        // não tem endpoint de histórico - parar perderia pra sempre os
        // pedidos do período de atraso. O bloqueio continua valendo na tela
        // (valores borrados) e no "Sincronizar" manual.
        await pollShopEvents(shop.id);
      } catch (err) {
        log.error({ err, shopId: shop.id }, 'Falha no polling de eventos da iFood.');
      }
    });
  } finally {
    running = false;
  }
}

export function startIfoodPollWatchdog(log: FastifyBaseLogger): void {
  const run = () => {
    pollAllShops(log).catch((err) => log.error({ err }, 'Falha ao verificar lojas iFood pra polling.'));
  };
  run();
  setInterval(run, POLL_INTERVAL_MS).unref();
}
