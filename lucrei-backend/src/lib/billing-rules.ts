import { Status } from '@apple/app-store-server-library';

// Regras puras de cobrança/assinatura (sem banco, sem API de provedor) -
// separadas aqui pra poderem ser testadas sem mock nenhum e reaproveitadas
// pelos webhooks (billing/routes.ts, apple-iap/routes.ts) e por /plans/select.

const DAY_MS = 24 * 60 * 60 * 1000;

// Mesmo valor de SUBSCRIPTION_GRACE_DAYS (subscription-access.ts) -
// duplicado aqui de propósito pra este arquivo não importar o prisma.
export const GRACE_DAYS = 7;

/**
 * currentPeriodEnd a gravar quando o acesso é REVOGADO (estorno, chargeback,
 * reembolso da Apple). getSubscriptionAccessStatus conta a carência a partir
 * de currentPeriodEnd - gravar "agora" ainda daria mais 7 dias de
 * sincronização de graça pra quem pegou o dinheiro de volta. Voltando a data
 * os dias da carência, a conta já cai em past_due COM a carência esgotada
 * (bloqueio na hora), sem precisar de um status novo só pra isso.
 */
export function revokedAccessPeriodEnd(now = Date.now()): Date {
  return new Date(now - GRACE_DAYS * DAY_MS);
}

/**
 * "Desde quando" a assinatura NOVA criada por /plans/select (sem teste
 * grátis, ainda não paga) deve contar a carência. Antes ficava nulo, e a
 * carência caía pro createdAt da assinatura nova - trocar de plano (ou
 * cancelar e assinar de novo) reiniciava os 7 dias a cada troca, acesso
 * infinito sem pagar. Agora herda o mesmo "desde quando" da assinatura
 * anterior da conta (fim do último período pago, ou a criação dela se nunca
 * pagou), nunca no futuro: a carência é uma só por atraso, não uma por
 * assinatura. Sem assinatura anterior (primeira vez) = null, carência normal
 * a partir da criação.
 */
export function inheritedGraceSince(
  previous: { currentPeriodEnd: Date | null; createdAt: Date } | null,
  now = new Date()
): Date | null {
  if (!previous) return null;
  const since = previous.currentPeriodEnd ?? previous.createdAt;
  return since.getTime() < now.getTime() ? since : now;
}

type PlanPrice = { id: string; priceCurrent: unknown };

/**
 * Plano que vale (limites) enquanto a troca de plano ainda não foi paga.
 * Nunca libera um plano MAIS CARO sem pagamento - fica no atual até o
 * webhook confirmar. Pra um plano igual ou mais barato (ou conta sem plano
 * nenhum, que hoje significaria "sem limite"), aplica o escolhido na hora:
 * não há ganho nenhum em trocar pra ele sem pagar.
 */
export function planWhilePaymentPending<T extends PlanPrice>(current: T | null, chosen: T): T {
  if (!current) return chosen;
  if (current.id === chosen.id) return chosen;
  const currentPrice = current.priceCurrent == null ? null : Number(current.priceCurrent);
  const chosenPrice = chosen.priceCurrent == null ? null : Number(chosen.priceCurrent);
  // Plano sob consulta (preço nulo) não tem como ser comparado - mantém o atual.
  if (currentPrice === null || chosenPrice === null) return current;
  return chosenPrice <= currentPrice ? chosen : current;
}

/**
 * Cobrança Pix já marcada 'approved' mas cuja ativação da assinatura não
 * chegou a ser gravada (falha transitória entre as duas escritas, antes de
 * ficarem na mesma transação) - nesse caso o reenvio do webhook pode
 * reprocessar. Só quando essa é a cobrança mais recente da assinatura (uma
 * mais nova, paga ou estornada, já decidiu o estado atual) e o período pago
 * por ela ainda não está gravado (a ativação sempre grava currentPeriodEnd =
 * periodEnd da cobrança). Olhar só pro status não serve: uma assinatura que
 * virou past_due no FIM do período pago por essa cobrança é o estado
 * correto, não uma ativação perdida.
 */
export function pixChargeNeedsActivationRecovery(
  subscription: { status: string; currentPeriodEnd: Date | null },
  charge: { periodEnd: Date },
  hasNewerCharge: boolean
): boolean {
  if (hasNewerCharge) return false;
  if (subscription.status === 'canceled') return false;
  return !subscription.currentPeriodEnd || subscription.currentPeriodEnd.getTime() < charge.periodEnd.getTime();
}

export type AppleResolvedStatus =
  | { kind: 'ok'; status: 'active' | 'past_due' | 'canceled' }
  | { kind: 'revoked' }
  | { kind: 'expired' };

/**
 * Status efetivo de uma transação Apple já verificada. Antes, sem status
 * explícito (compra síncrona do app), a conta virava 'active' sempre -
 * reenviar um JWS antigo (válido e assinado, mas de uma assinatura já
 * vencida) reabria o acesso pra sempre. Agora:
 *  - revocationDate presente ou status REVOKED -> 'revoked' (reembolso);
 *  - sem status explícito e expiresDate já passou -> 'expired';
 *  - status ACTIVE mas expiresDate já passou (reenvio de notificação velha)
 *    -> 'canceled', nunca 'active'.
 */
export function resolveAppleTransactionStatus(
  params: { explicitStatus?: Status; expiresDate?: number; revocationDate?: number },
  now = Date.now()
): AppleResolvedStatus {
  const { explicitStatus, expiresDate, revocationDate } = params;
  if (revocationDate || explicitStatus === Status.REVOKED) return { kind: 'revoked' };

  const alreadyExpired = expiresDate !== undefined && expiresDate <= now;

  if (explicitStatus === undefined) {
    return alreadyExpired ? { kind: 'expired' } : { kind: 'ok', status: 'active' };
  }

  if (explicitStatus === Status.ACTIVE) return { kind: 'ok', status: alreadyExpired ? 'canceled' : 'active' };
  if (explicitStatus === Status.BILLING_RETRY || explicitStatus === Status.BILLING_GRACE_PERIOD) {
    return { kind: 'ok', status: 'past_due' };
  }
  return { kind: 'ok', status: 'canceled' }; // EXPIRED
}

/**
 * Resumo de um webhook da HyperCash pra alerta por e-mail - só ids, status e
 * valor. O corpo bruto tem dados pessoais do pagador (nome, e-mail,
 * documento) que não devem circular em e-mail de alerta.
 */
export function summarizeHypercashWebhook(body: unknown): string {
  const lines: string[] = [];
  const root = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (typeof root.type === 'string') lines.push(`type: ${root.type}`);
  if (typeof root.id === 'string') lines.push(`event id: ${root.id}`);

  const data = (root.data && typeof root.data === 'object' ? root.data : {}) as Record<string, unknown>;
  const SAFE_KEYS = ['id', 'paymentLinkId', 'status', 'amount', 'amountCents', 'currentPeriodEnd'];
  for (const section of ['subscription', 'transaction']) {
    const obj = data[section];
    if (!obj || typeof obj !== 'object') continue;
    for (const key of SAFE_KEYS) {
      const value = (obj as Record<string, unknown>)[key];
      if (typeof value === 'string' || typeof value === 'number') lines.push(`${section}.${key}: ${value}`);
    }
  }
  if (lines.length === 0) lines.push('(payload sem campos reconhecidos)');
  return lines.join('\n');
}
