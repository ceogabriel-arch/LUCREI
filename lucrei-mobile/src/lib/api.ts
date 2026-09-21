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
  plan: UserPlan | null;
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

export type Summary = {
  revenue: number;
  cost: number;
  shippingCost: number;
  shopeeFees: number;
  productCost: number;
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

// from/to (ISO) pro relatório de ano/mês específico em Relatórios - period
// só cobre os presets fixos (hoje/7d/30d/all), não um intervalo arbitrário.
export function getSummaryRange(token: string, shopId: string, from: Date, to: Date) {
  const query = `from=${from.toISOString()}&to=${to.toISOString()}`;
  return request<Summary>(`/shops/${shopId}/summary?${query}`, {
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
};

export function getOrders(token: string, shopId: string, period: Period) {
  return request<{ orders: Order[] }>(`/shops/${shopId}/orders?period=${period}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type SyncResult = { ordersSeen: number; ordersSynced: number };

export function syncOrders(token: string, shopId: string) {
  return request<SyncResult>(`/shops/${shopId}/sync`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: '{}',
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
export type SyncHistoryStatus = { status: 'idle' | 'running' | 'done' | 'error'; ordersSynced: number; error?: string | null };

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

export function selectPlanPix(token: string, key: string) {
  return request<AuthUser & { pix: PixCharge | null }>('/plans/select-pix', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ key }),
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
