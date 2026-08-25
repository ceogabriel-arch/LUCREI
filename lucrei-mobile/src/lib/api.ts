const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type AuthUser = { id: string; name: string; email: string };
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

export type Shop = { id: string; shopName: string; status: string; connectedAt: string };

export function getShops(token: string) {
  return request<{ shops: Shop[] }>('/shopee/shops', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export type Summary = {
  revenue: number;
  cost: number;
  profit: number;
  ordersCount: number;
  avgTicket: number;
  profitMargin: number;
  itemsMissingCost: number;
  trend: number[];
};

export function getSummary(token: string, shopId: string, period: 'today' | '7d' | '30d') {
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

export function getShopeeProducts(token: string, shopId: string, period: 'today' | '7d' | '30d') {
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
