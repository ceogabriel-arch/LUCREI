import { checkSalesLimitBlock } from './sales-usage';
import { checkSubscriptionAccessBlock } from './subscription-access';

export type SyncAccessBlock =
  | { blocked: false }
  | { blocked: true; code: 'subscription_past_due' | 'sales_limit_reached'; message: string };

// Fonte única de "essa conta pode sincronizar pedido agora?". Antes isso só
// existia nas rotas de sync (botão do app) - watchdog, push da Shopee,
// webhook do Mercado Livre e polling da iFood continuavam sincronizando
// conta bloqueada (pagamento atrasado ou limite de vendas estourado depois
// da carência), o que tirava todo o sentido do bloqueio.
export async function checkSyncAccessBlock(userId: string): Promise<SyncAccessBlock> {
  const subscriptionBlock = await checkSubscriptionAccessBlock(userId);
  if (subscriptionBlock.blocked) {
    return { blocked: true, code: 'subscription_past_due', message: subscriptionBlock.message };
  }

  const salesBlock = await checkSalesLimitBlock(userId);
  if (salesBlock.blocked) {
    return { blocked: true, code: 'sales_limit_reached', message: salesBlock.message };
  }

  return { blocked: false };
}

// Polling da iFood roda a cada 30s por loja e push/webhook chegam a cada
// mudança de status - checar assinatura + contar pedidos do mês no banco a
// cada um desses seria caro à toa. 2min de cache é atraso irrelevante tanto
// pra bloquear quanto pra liberar depois do pagamento.
const CACHE_TTL_MS = 2 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; blocked: boolean }>();

export async function isSyncBlockedCached(userId: string): Promise<boolean> {
  const now = Date.now();
  const hit = cache.get(userId);
  if (hit && hit.expiresAt > now) return hit.blocked;

  const { blocked } = await checkSyncAccessBlock(userId);
  cache.set(userId, { expiresAt: now + CACHE_TTL_MS, blocked });
  return blocked;
}

export function clearSyncAccessCache() {
  cache.clear();
}
