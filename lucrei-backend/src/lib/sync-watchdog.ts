import type { FastifyBaseLogger } from 'fastify';

import { prisma } from './prisma';

// Mesmos limites que já existiam só pra DETECTAR no painel /admin/sync-issues
// (ver admin/routes.ts) - esse módulo também CORRIGE sozinho, não só avisa.
// 20/30 min é bem mais que o tempo normal de uma sincronização (minutos, não
// dezenas) - uma loja real (Rubia Fantasias) ficou 7 DIAS presa em "rodando"
// porque um deploy nosso reiniciou o servidor no meio da sincronização dela,
// sem nada que destravasse isso sozinho depois.
export const STUCK_SYNC_MINUTES = 20;
export const STUCK_BACKFILL_MINUTES = 30;

// Roda com que frequência o watchdog verifica lojas presas, além de uma vez
// já na subida do servidor (pra pegar o que travou ANTES dessa execução
// começar, como o caso da Rubia).
const WATCHDOG_INTERVAL_MS = 10 * 60 * 1000;

// Exportado separado de resetStuckSyncs pra poder testar a lógica pura sem
// mexer no banco de verdade.
export function isSyncStuck(shop: {
  syncStatus: string | null;
  syncStartedAt: Date | null;
  historyBackfillStatus: string | null;
  historyBackfillStartedAt: Date | null;
}, now = Date.now()): { sync: boolean; backfill: boolean } {
  const sync =
    shop.syncStatus === 'running' &&
    shop.syncStartedAt !== null &&
    now - shop.syncStartedAt.getTime() > STUCK_SYNC_MINUTES * 60_000;
  const backfill =
    shop.historyBackfillStatus === 'running' &&
    shop.historyBackfillStartedAt !== null &&
    now - shop.historyBackfillStartedAt.getTime() > STUCK_BACKFILL_MINUTES * 60_000;
  return { sync, backfill };
}

// Varre todas as lojas ativas e destrava (marca como 'error', com uma
// mensagem clara) qualquer sincronização ou backfill de histórico que esteja
// "rodando" havia mais tempo do que uma sincronização de verdade jamais
// leva. 'error' é o status certo aqui (não um 4º status novo): é exatamente
// o que o app já sabe mostrar quando uma sincronização falha de verdade, e
// libera a próxima tentativa (sync normal e o botão de backfill já ignoram
// loja com status 'error', só travam quando está 'running').
export async function resetStuckSyncs(logger?: FastifyBaseLogger): Promise<number> {
  const now = Date.now();
  const candidates = await prisma.shop.findMany({
    where: {
      status: 'active',
      OR: [{ syncStatus: 'running' }, { historyBackfillStatus: 'running' }],
    },
    select: {
      id: true,
      shopName: true,
      syncStatus: true,
      syncStartedAt: true,
      historyBackfillStatus: true,
      historyBackfillStartedAt: true,
    },
  });

  let recovered = 0;
  for (const shop of candidates) {
    const { sync, backfill } = isSyncStuck(shop, now);
    if (!sync && !backfill) continue;

    const data: Record<string, unknown> = {};
    if (sync) {
      data.syncStatus = 'error';
      data.syncError = `Sincronização travada (sem terminar havia mais de ${STUCK_SYNC_MINUTES} min) - destravada automaticamente pelo watchdog.`;
    }
    if (backfill) {
      data.historyBackfillStatus = 'error';
      data.historyBackfillError = `Busca de histórico travada (sem terminar havia mais de ${STUCK_BACKFILL_MINUTES} min) - destravada automaticamente pelo watchdog.`;
    }

    await prisma.shop.update({ where: { id: shop.id }, data });
    recovered++;
    logger?.warn({ shopId: shop.id, shopName: shop.shopName, sync, backfill }, 'watchdog: sincronização travada destravada');
  }

  return recovered;
}

// Chamado uma vez na subida do servidor (ver index.ts) - inicia a varredura
// imediata (pega o que travou antes do processo atual existir) e agenda as
// seguintes. Falha de uma rodada (ex: banco fora do ar um instante) não para
// o watchdog - só loga e tenta de novo na próxima.
export function startSyncWatchdog(logger: FastifyBaseLogger): void {
  const run = () => {
    resetStuckSyncs(logger).catch((err) => {
      logger.error({ err }, 'watchdog: falha ao verificar sincronizações travadas');
    });
  };
  run();
  setInterval(run, WATCHDOG_INTERVAL_MS).unref();
}
