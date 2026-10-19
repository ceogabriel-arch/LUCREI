import type { FastifyBaseLogger } from 'fastify';

import { mapLimit } from './concurrency';
import { prisma } from './prisma';
import { runShopSync } from '../modules/sync/service';
import { runShopSync as runMLShopSync } from '../modules/sync/mercadolivre-service';

// Achado ao vivo (16-18/10): a loja da Rubia ficou 3 dias sem receber pedido
// nenhum porque o push em tempo real da Shopee (assinatura calculada em cima
// de PUBLIC_APP_URL - ver shopee/push em shops/routes.ts) ficou rejeitando
// tudo sem que ninguém percebesse, e nada mais força uma sincronização sem a
// pessoa abrir o app e clicar em "Sincronizar". Esse watchdog é a rede de
// segurança: varre sozinho qualquer loja ativa que não sincroniza há um
// tempo, sem depender do push nem de ação nenhuma do usuário.
export const STALE_SYNC_HOURS = 3;

const WATCHDOG_INTERVAL_MS = 60 * 60 * 1000;

// No máximo 3 lojas sincronizando ao mesmo tempo - uma pane longa do push
// (ou o servidor ficando fora do ar um tempo) pode acumular muitas lojas
// stale de uma vez, e cada sincronização já faz várias chamadas à API da
// Shopee/Mercado Livre por conta própria (ver mapLimit em sync/service.ts) -
// sincronizar todo mundo em paralelo sem limite arriscaria estourar o rate
// limit dos dois marketplaces de uma vez.
const SYNC_CONCURRENCY = 3;

export function isShopSyncStale(
  shop: { status: string; syncStatus: string | null; lastSyncedAt: Date | null },
  now = Date.now()
): boolean {
  if (shop.status !== 'active') return false;
  // Nunca mexe numa sincronização rodando agora - uma travada de verdade já
  // é destravada pelo sync-watchdog (vira 'error', elegível na próxima
  // rodada deste watchdog).
  if (shop.syncStatus === 'running') return false;
  if (!shop.lastSyncedAt) return true;
  return now - shop.lastSyncedAt.getTime() > STALE_SYNC_HOURS * 60 * 60 * 1000;
}

export async function syncStaleShops(logger?: FastifyBaseLogger): Promise<number> {
  const now = Date.now();
  const candidates = await prisma.shop.findMany({
    where: { status: 'active', syncStatus: { not: 'running' } },
    select: { id: true, shopName: true, provider: true, status: true, syncStatus: true, lastSyncedAt: true },
  });

  const stale = candidates.filter((shop) => isShopSyncStale(shop, now));
  if (stale.length === 0) return 0;

  await mapLimit(stale, SYNC_CONCURRENCY, async (shop) => {
    logger?.warn(
      { shopId: shop.id, shopName: shop.shopName, lastSyncedAt: shop.lastSyncedAt },
      'watchdog: loja sem sincronizar há tempo demais, sincronizando sozinho'
    );
    const sync = shop.provider === 'mercado_livre' ? runMLShopSync : runShopSync;
    // runShopSync/runMLShopSync já marcam 'running'/'done'/'error' e gravam
    // lastSyncedAt sozinhos (mesmo caminho do botão manual) - erro de uma
    // loja não deve travar nem pular as outras.
    try {
      await sync(shop.id);
    } catch (err) {
      logger?.error({ err, shopId: shop.id }, 'watchdog: falha ao sincronizar loja sozinho');
    }
  });

  return stale.length;
}

export function startShopSyncWatchdog(logger: FastifyBaseLogger): void {
  const run = () => {
    syncStaleShops(logger).catch((err) => {
      logger.error({ err }, 'watchdog: falha ao verificar lojas sem sincronizar');
    });
  };
  run();
  setInterval(run, WATCHDOG_INTERVAL_MS).unref();
}
