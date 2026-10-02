export const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type Period = 'today' | '7d' | '30d' | 'all';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';
export type UserPlan = { key: string; name: string; salesLimit: number | null; billingPeriod: BillingPeriod };
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  hasPassword: boolean;
  createdAt: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  // Espelha SalesUsage.blocked/graceDaysLeft, mas pro pagamento em atraso -
  // subscriptionBlocked só vira true depois da carência de 7 dias (ver
  // getSubscriptionAccessStatus no backend); até lá, graceDaysLeft conta
  // quanto falta.
  subscriptionBlocked: boolean;
  subscriptionGraceDaysLeft: number | null;
  plan: UserPlan | null;
  // null enquanto a pessoa nunca configurou uma meta diária em Configurações.
  dailyProfitGoal: number | null;
  // Só vem preenchido na resposta de /auth/me (não em login/signup/planos).
  salesUsedThisMonth?: number | null;
};
export type AuthResponse = { token: string; user: AuthUser };

export class ApiError extends Error {}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_URL) {
    throw new ApiError('Servidor não configurado (EXPO_PUBLIC_API_URL ausente).');
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor.');
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(body?.message ?? 'Algo deu errado. Tente novamente.');
  }
  return body as T;
}

export function signup(name: string, email: string, password: string) {
  return request<AuthResponse>('/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });
}

export function requestPasswordReset(email: string) {
  return request<{ ok: true }>('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function login(email: string, password: string) {
  return request<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export function googleAuth(idToken: string) {
  return request<AuthResponse>('/auth/google', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  });
}

export function me(token: string) {
  return request<AuthUser>('/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function updateName(token: string, name: string) {
  return request<AuthUser>('/auth/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
}

// Sugestão pra pré-preencher o campo em Configurações - média do lucro
// diário dos últimos 30 dias.
export function getDailyGoalSuggestion(token: string) {
  return request<{ suggestion: number }>('/auth/daily-goal-suggestion', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// null limpa a meta (desliga a notificação de "Meta batida").
export function updateDailyGoal(token: string, dailyProfitGoal: number | null) {
  return request<AuthUser>('/auth/daily-goal', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ dailyProfitGoal }),
  });
}

export function changePassword(token: string, currentPassword: string | undefined, newPassword: string) {
  return request<{ ok: true; token: string }>('/auth/change-password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export function deleteAccount(token: string, password: string | undefined) {
  return request<{ ok: true }>('/auth/me', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ password }),
  });
}

export function savePushToken(token: string, pushToken: string) {
  return request<{ ok: true }>('/auth/push-token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ token: pushToken }),
  });
}

export type Shop = {
  id: string;
  shopName: string;
  status: string;
  connectedAt: string;
  disconnectedAt: string | null;
  provider: 'shopee' | 'mercado_livre';
  // null = nunca rodou. Usado pra saber se ainda vale a pena empurrar a
  // pessoa pra sincronizar o histórico completo (ver history-backfill-card).
  historyBackfillStatus: 'running' | 'done' | 'error' | null;
  // null = nenhuma sincronização do dia a dia rodou ainda (loja recém-
  // conectada) - usado pra não mostrar "R$ 0,00" cru antes da primeira
  // sincronização terminar (ver Início).
  syncStatus: 'running' | 'done' | 'error' | null;
  // null enquanto a loja não tem alíquota de imposto configurada - hoje só o
  // cálculo de lucro da Shopee usa isso de verdade.
  taxRatePercent: number | null;
};

export function getShops(token: string) {
  return request<{ shops: Shop[] }>('/shopee/shops', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function disconnectShop(token: string, shopId: string) {
  return request<{ id: string; status: string; disconnectedAt: string }>(`/shops/${shopId}/disconnect`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: '{}',
  });
}

export function updateShopTaxRate(token: string, shopId: string, taxRatePercent: number | null) {
  return request<{ id: string; taxRatePercent: number | null }>(`/shops/${shopId}/tax-rate`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ taxRatePercent }),
  });
}

export type Summary = {
  revenue: number;
  cost: number;
  shippingCost: number;
  shopeeFees: number;
  productCost: number;
  taxCost: number;
  profit: number;
  ordersCount: number;
  avgTicket: number;
  profitMargin: number;
  itemsMissingCost: number;
  trend: { date: string; profit: number }[];
};

export function getSummary(token: string, shopId: string, period: Period) {
  return request<Summary>(`/shops/${shopId}/summary?period=${period}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Soma o resumo de todas as lojas ativas da conta (qualquer marketplace) -
// usado pra "Todas as lojas" no Início e pro lucro vitalício das conquistas
// (que sempre precisa ser cross-loja, não só da loja selecionada no momento).
export function getCombinedSummary(token: string, period: Period) {
  return request<Summary>(`/summary?period=${period}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Previsão de lucro (Início) - pedidos comprados na Shopee que ainda não
// completaram, multiplicado pelo lucro médio dos pedidos concluídos
// recentemente. Estimativa, não é o lucro real que "Você lucrou" mostra.
export type OrderForecast = { pendingCount: number; projectedProfit: number };

export function getOrderForecast(token: string, shopId: string) {
  return request<OrderForecast>(`/shops/${shopId}/order-forecast`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getCombinedOrderForecast(token: string) {
  return request<OrderForecast>('/order-forecast', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Detalhe dos pedidos por trás da previsão acima - abre ao tocar no card.
// shopName só vem preenchido na versão combinada (uma loja só não precisa
// dizer o nome dela de novo).
export type PendingOrder = {
  orderSn: string;
  status: string;
  orderDate: string;
  shopName?: string;
  provider: 'shopee' | 'mercado_livre';
  product: string | null;
  estimatedProfit: number;
};

export function getPendingOrders(token: string, shopId: string) {
  return request<PendingOrder[]>(`/shops/${shopId}/order-forecast/pending`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getCombinedPendingOrders(token: string) {
  return request<PendingOrder[]>('/order-forecast/pending', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// from/to (ISO) pro relatório de ano/mês específico em Relatórios - period
// só cobre os presets fixos (hoje/7d/30d/all), não um intervalo arbitrário.
export function getSummaryRange(token: string, shopId: string, from: Date, to: Date) {
  const query = `from=${from.toISOString()}&to=${to.toISOString()}`;
  return request<Summary>(`/shops/${shopId}/summary?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Mesma ideia de getSummaryRange, somado pra todas as lojas ativas - o
// backend (/summary) já aceita from/to além de period, então não precisa de
// rota nova.
export function getCombinedSummaryRange(token: string, from: Date, to: Date) {
  const query = `from=${from.toISOString()}&to=${to.toISOString()}`;
  return request<Summary>(`/summary?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type ShopeeProduct = {
  shopeeItemId: string;
  name: string;
  image: string | null;
  price: number | null;
  costPrice: number | null;
  profit: number | null;
  revenue: number | null;
  orders: number;
  // Preenchidos só no cliente no modo "Todas as lojas" (ver produtos.tsx),
  // igual Order.shopName - a API nunca manda isso, cada chamada já é de
  // uma loja só. shopId é o que permite editar custo mesmo no combinado -
  // salvar agrupa por ele antes de chamar saveProductCosts.
  shopName?: string;
  shopId?: string;
};

export function getShopeeProducts(token: string, shopId: string, period: Period, force = false) {
  const query = `period=${period}${force ? '&force=true' : ''}`;
  return request<{ products: ShopeeProduct[] }>(`/shops/${shopId}/shopee-products?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function saveProductCost(token: string, shopId: string, shopeeItemId: string, name: string, costPrice: number) {
  return request(`/shops/${shopId}/products`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ shopeeItemId, name, costPrice }),
  });
}

// Itens vendidos que não batem com nenhum produto do catálogo atual da
// Shopee (normalmente porque foram excluídos de lá) - a tela normal de
// Produtos não mostra eles, então ficam pra sempre "sem custo" sem essa lista.
export type OrphanProduct = { shopeeItemId: string; name: string | null; ordersAffected: number };

export function getOrphanProducts(token: string, shopId: string) {
  return request<{ orphans: OrphanProduct[] }>(`/shops/${shopId}/orphan-products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type ProductCostInput = { shopeeItemId: string; name: string; costPrice: number };

export function saveProductCosts(token: string, shopId: string, items: ProductCostInput[]) {
  return request(`/shops/${shopId}/products/batch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ items }),
  });
}

export type OrderLineItem = {
  id: string;
  productName: string;
  quantity: number;
  salePrice: number;
  shippingFeeAllocated: number;
  shopeeFeeAllocated: number;
  taxAllocated: number;
  productCostSnapshot: number | null;
  profit: number | null;
};

export type Order = {
  id: string;
  shopeeOrderSn: string;
  orderStatus: string;
  orderDate: string;
  revenue: number;
  profit: number | null;
  itemsMissingCost: number;
  lineItems: OrderLineItem[];
  // Preenchido só no cliente ao combinar pedidos de várias lojas (ver
  // pedidos.tsx, modo "Todas as lojas") - a resposta da API em si nunca
  // manda isso, já que cada chamada já é por uma loja só.
  shopName?: string;
};

export function getOrders(token: string, shopId: string, period: Period) {
  return request<{ orders: Order[] }>(`/shops/${shopId}/orders?period=${period}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Sync roda em segundo plano no servidor, igual ao backfill de histórico -
// travar a requisição inteira até terminar é o que mais pesa quando muita
// gente sincroniza ao mesmo tempo. startSync só dispara, getSyncStatus é o
// que o app usa pra acompanhar (polling).
export type SyncStatus = { status: 'idle' | 'running' | 'done' | 'error'; ordersSynced: number; error?: string | null };

export function startSync(token: string, shopId: string) {
  return request<SyncStatus>(`/shops/${shopId}/sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: '{}',
  });
}

export function getSyncStatus(token: string, shopId: string) {
  return request<SyncStatus>(`/shops/${shopId}/sync`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// Sync normal só cobre os últimos 15 dias (limite da própria API da
// Shopee) - esse backfill varre até 1 ano pra trás em blocos de 15 dias, pra
// relatórios de mês/ano específico terem dado de verdade. Roda em segundo
// plano no servidor (pode levar minutos numa loja com muito histórico, tempo
// demais pra segurar numa requisição só) - startSyncHistory só dispara,
// getSyncHistoryStatus é o que o app usa pra acompanhar (polling).
// Endpoint é "/backfill", não ".../sync/history" - bloqueadores de anúncio
// costumam ter regra pra barrar qualquer URL com "/sync/" no caminho (usado
// por ad-tech pra sincronizar cookies), e como isso aqui é consultado a cada
// poucos segundos por minutos, esse endpoint concentra muito mais chamadas
// que qualquer outro da página - exatamente o que aconteceu em produção.
export type SyncHistoryStatus = {
  status: 'idle' | 'running' | 'done' | 'error';
  ordersSynced: number;
  windowsDone: number;
  windowsTotal: number;
  error?: string | null;
};

export function startSyncHistory(token: string, shopId: string) {
  return request<SyncHistoryStatus>(`/shops/${shopId}/backfill`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: '{}',
  });
}

export function getSyncHistoryStatus(token: string, shopId: string) {
  return request<SyncHistoryStatus>(`/shops/${shopId}/backfill`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type SalesUsage = {
  ordersThisMonth: number;
  salesLimit: number | null;
  overLimit: boolean;
  blocked: boolean;
  graceDaysLeft: number | null;
};

export function getSalesUsage(token: string) {
  return request<SalesUsage>('/plans/usage', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type BillingPeriod = 'monthly' | 'annual';
export type Plan = {
  key: string;
  groupKey: string;
  billingPeriod: BillingPeriod;
  trialEligible: boolean;
  name: string;
  salesLimit: number | null;
  integrationsLimit: number | null;
  priceOriginal: number | null;
  priceCurrent: number | null;
};

export function getPlans() {
  return request<{ plans: Plan[] }>('/plans');
}

export function selectPlan(token: string, key: string) {
  // checkoutUrl vem preenchido no fluxo normal; pix vem no lugar quando é um
  // upgrade de plano anual no meio do ciclo (cobrança proporcional avulsa) -
  // nesse caso o plano só muda depois que o Pix for pago, não nessa resposta.
  return request<AuthUser & { checkoutUrl?: string | null; pix?: PixCharge | null }>('/plans/select', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key }),
  });
}

export function getCheckoutUrl(token: string) {
  return request<{ checkoutUrl: string | null }>('/plans/checkout-url', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type PixCharge = { qrCode: string; qrCodeBase64: string; expiresAt: string; amount: number };

export function selectPlanPix(token: string, key: string, couponCode?: string) {
  return request<AuthUser & { pix: PixCharge | null }>('/plans/select-pix', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(couponCode ? { key, couponCode } : { key }),
  });
}

export type CouponPreview = { code: string; percentOff: number };

// Cupom só se aplica ao fluxo Pix (ver comentário em Subscription no
// backend) - por isso não existe equivalente pra selectPlan (cartão).
export function validateCoupon(token: string, code: string) {
  return request<CouponPreview>('/coupons/validate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ code }),
  });
}

export function getCurrentPixCharge(token: string) {
  return request<{ pix: PixCharge | null }>('/billing/pix/current', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function cancelPlan(token: string) {
  return request<AuthUser>('/plans/cancel', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: '{}',
  });
}

export function getClaimedRewardTiers(token: string) {
  return request<{ claimedTiers: number[] }>('/rewards/claims', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type ClaimRewardInput = {
  tierThreshold: number;
  fullName: string;
  phone?: string;
  addressLine: string;
  city: string;
  state: string;
  zipCode: string;
};

export function claimReward(token: string, input: ClaimRewardInput) {
  return request<{ ok: true }>('/rewards/claim', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
}

// ---- Admin (só pra conta configurada em ADMIN_EMAILS no backend) ----

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  subscriptionStatus: SubscriptionStatus;
  planName: string | null;
  shopsCount: number;
  createdAt: string;
  trialEndsAt: string | null;
};

export function getAdminUsers(token: string) {
  return request<AdminUser[]>('/admin/users', { headers: { Authorization: `Bearer ${token}` } });
}

export type AdminRewardClaim = {
  id: string;
  userEmail: string;
  tierThreshold: number;
  fullName: string;
  phone: string | null;
  addressLine: string;
  city: string;
  state: string;
  zipCode: string;
  createdAt: string;
  fulfilledAt: string | null;
};

export function getAdminRewardClaims(token: string) {
  return request<AdminRewardClaim[]>('/admin/reward-claims', { headers: { Authorization: `Bearer ${token}` } });
}

export function setAdminRewardClaimFulfilled(token: string, id: string, fulfilled: boolean) {
  return request<{ id: string; fulfilledAt: string | null }>(`/admin/reward-claims/${id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fulfilled }),
  });
}

export type AdminSyncIssue = {
  shopId: string;
  shopName: string;
  provider: 'shopee' | 'mercado_livre';
  userEmail: string;
  syncStatus: string | null;
  syncError: string | null;
  syncStartedAt: string | null;
  historyBackfillStatus: string | null;
  historyBackfillError: string | null;
  historyBackfillStartedAt: string | null;
};

export function getAdminSyncIssues(token: string) {
  return request<AdminSyncIssue[]>('/admin/sync-issues', { headers: { Authorization: `Bearer ${token}` } });
}

export type AdminMetrics = {
  totalUsers: number;
  usersByStatus: { status: SubscriptionStatus; count: number }[];
  activeSubscriptions: number;
  mrrEstimate: number;
  shopsByProvider: { provider: 'shopee' | 'mercado_livre'; count: number }[];
};

export function getAdminMetrics(token: string) {
  return request<AdminMetrics>('/admin/metrics', { headers: { Authorization: `Bearer ${token}` } });
}
