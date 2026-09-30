/**
 * Cliente da API do Mercado Livre (OAuth2 padrão, Bearer token - diferente da
 * Shopee, que assina cada chamada com HMAC). Endpoints e formato de resposta
 * documentados em developers.mercadolivre.com.br; confirmar contra uma
 * autorização real antes de depender disso em produção.
 *
 * Importante: ao contrário do refresh token da Shopee (fixo por 30 dias,
 * reutilizável em qualquer refresh), o refresh_token do Mercado Livre roda
 * UMA vez só - toda resposta de refresh (inclusive a troca inicial do code)
 * vem com um refresh_token NOVO, que precisa substituir o salvo. Usar um
 * refresh_token já consumido falha.
 */

const AUTH_HOST = 'https://auth.mercadolivre.com.br';
const API_HOST = 'https://api.mercadolibre.com';
const DEFAULT_TIMEOUT_MS = 15_000;

function getConfig() {
  const clientId = process.env.MERCADOLIVRE_CLIENT_ID;
  const clientSecret = process.env.MERCADOLIVRE_CLIENT_SECRET;
  const callbackUrl = process.env.MERCADOLIVRE_CALLBACK_URL;

  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error(
      'Credenciais do Mercado Livre não configuradas (MERCADOLIVRE_CLIENT_ID / MERCADOLIVRE_CLIENT_SECRET / MERCADOLIVRE_CALLBACK_URL).'
    );
  }

  return { clientId, clientSecret, callbackUrl };
}

// Mesmo motivo do shopee-client: sem timeout, uma resposta lenta trava a
// chamada inteira.
async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ ok: boolean; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = (await response.json()) as T;
    return { ok: response.ok, body };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('O Mercado Livre demorou demais pra responder.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function getAuthorizationUrl(state: string) {
  const { clientId, callbackUrl } = getConfig();
  const url = new URL(`${AUTH_HOST}/authorization`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user_id: number;
  error?: string;
  message?: string;
};

export async function exchangeCodeForToken(code: string) {
  const { clientId, clientSecret, callbackUrl } = getConfig();
  const { ok, body } = await fetchJson<TokenResponse>(`${API_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: callbackUrl,
    }).toString(),
  });
  if (!ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao trocar code por token no Mercado Livre.');
  }
  return body;
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getConfig();
  const { ok, body } = await fetchJson<TokenResponse>(`${API_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }).toString(),
  });
  if (!ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao renovar o token do Mercado Livre.');
  }
  return body;
}

type UserResponse = {
  id: number;
  nickname: string;
  error?: string;
  message?: string;
};

export async function getUser(accessToken: string) {
  const { ok, body } = await fetchJson<UserResponse>(`${API_HOST}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar dados da conta no Mercado Livre.');
  }
  return body;
}

// Confirmado contra uma chamada real (Fase 2, Passo 0): devolve 200 com
// "results: []" pra loja sem pedido, formato bate com a documentação.
type OrderSearchResponse = {
  results?: { id: number; status: string; date_created: string; date_closed: string | null }[];
  paging?: { total: number; offset: number; limit: number };
  error?: string;
  message?: string;
};

export async function searchOrders(
  accessToken: string,
  sellerId: string,
  opts: { dateFrom?: string; dateTo?: string; offset?: number; limit?: number } = {}
) {
  const params = new URLSearchParams({
    seller: sellerId,
    sort: 'date_desc',
    offset: String(opts.offset ?? 0),
    limit: String(opts.limit ?? 50),
  });
  if (opts.dateFrom) params.set('order.date_created.from', opts.dateFrom);
  if (opts.dateTo) params.set('order.date_created.to', opts.dateTo);

  const { ok, body } = await fetchJson<OrderSearchResponse>(`${API_HOST}/orders/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar pedidos no Mercado Livre.');
  }
  return { results: body.results ?? [], paging: body.paging };
}

// Campos de taxa/repasse (sale_fee em order_items, ou billing) ainda não
// confirmados contra um pedido real com venda de verdade (Passo 0 do plano
// de Fase 2 ainda pendente disso) - o tipo abaixo cobre só o que já foi
// confirmado como estrutura (status, itens, envio), NÃO assumir profit a
// partir daqui sem validar sale_fee primeiro.
type OrderDetailResponse = {
  id?: number;
  status?: string;
  date_created?: string;
  date_closed?: string | null;
  total_amount?: number;
  order_items?: {
    item: { id: string; title: string; variation_id?: number | null };
    quantity: number;
    unit_price: number;
    sale_fee?: number;
  }[];
  shipping?: { id: number | null };
  error?: string;
  message?: string;
};

export async function getOrder(accessToken: string, orderId: number) {
  const { ok, body } = await fetchJson<OrderDetailResponse>(`${API_HOST}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar detalhe do pedido no Mercado Livre.');
  }
  return body;
}

// Frete que sai do bolso do vendedor - GET /shipments/{id}/costs, "senders"
// é um array (normalmente 1 item) com o custo do lado do vendedor.
type ShipmentCostsResponse = {
  receiver?: { cost: number };
  senders?: { user_id: number; cost: number }[];
  error?: string;
  message?: string;
};

export async function getShipmentCosts(accessToken: string, shipmentId: number) {
  const { ok, body } = await fetchJson<ShipmentCostsResponse>(`${API_HOST}/shipments/${shipmentId}/costs`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar custo de envio no Mercado Livre.');
  }
  return body;
}

type ItemSearchResponse = {
  results?: string[];
  paging?: { total: number; offset: number; limit: number };
  scroll_id?: string;
  error?: string;
  message?: string;
};

// search_type=scan é obrigatório pra vendedor com mais de 1000 itens
// (offset comum trava nesse teto) - scroll_id precisa ser reenviado a cada
// página, expira em 5min. Sem scrollId na primeira chamada.
export async function searchItems(accessToken: string, sellerId: string, opts: { scrollId?: string } = {}) {
  const params = new URLSearchParams({ search_type: 'scan' });
  if (opts.scrollId) params.set('scroll_id', opts.scrollId);

  const { ok, body } = await fetchJson<ItemSearchResponse>(
    `${API_HOST}/users/${sellerId}/items/search?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar itens no Mercado Livre.');
  }
  return { results: body.results ?? [], scrollId: body.scroll_id };
}

type ItemMultigetEntry = {
  code: number;
  body: {
    id: string;
    title: string;
    price: number;
    status: string;
    thumbnail?: string;
    variations?: { id: number; price: number; attribute_combinations?: { name: string; value_name: string }[] }[];
  };
};

// Multiget - GET /items?ids=ID1,ID2,... (limite documentado de 20 ids por
// chamada, diferente do multiget da Shopee).
export async function getItems(accessToken: string, ids: string[]) {
  const { ok, body } = await fetchJson<ItemMultigetEntry[]>(`${API_HOST}/items?ids=${ids.join(',')}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!ok) {
    throw new Error('Falha ao buscar detalhe de itens no Mercado Livre.');
  }
  return body.filter((entry) => entry.code === 200).map((entry) => entry.body);
}
