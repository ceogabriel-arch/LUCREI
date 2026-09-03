export const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type Period = 'today' | '7d' | '30d' | 'all';

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'canceled';
export type UserPlan = { key: string; name: string };
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  subscriptionStatus: SubscriptionStatus;
  trialEndsAt: string | null;
  plan: UserPlan | null;
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

export function changePassword(token: string, currentPassword: string, newPassword: string) {
  return request<{ ok: true }>('/auth/change-password', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ currentPassword, newPassword }),
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

export function getShopeeProducts(token: string, shopId: string, period: Period) {
  return request<{ products: ShopeeProduct[] }>(`/shops/${shopId}/shopee-products?period=${period}`, {
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

export type Plan = {
  key: string;
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
  return request<AuthUser & { checkoutUrl: string | null }>('/plans/select', {
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

export function cancelPlan(token: string) {
  return request<AuthUser>('/plans/cancel', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: '{}',
  });
}
