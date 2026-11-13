/**
 * Cliente da API de parceiros da iFood. NÃO confirmado contra uma
 * autorização real ainda (developer.ifood.com.br exige login pra ver a
 * documentação completa) - o formato abaixo segue o padrão OAuth2 +
 * polling de eventos que a própria iFood descreve publicamente e que
 * integrações de terceiros (SDKs não-oficiais) implementam, igual o
 * mercado-livre-client fez antes de confirmar contra uma loja real.
 * Precisa validar nomes de campo e endpoints exatos assim que houver
 * credenciais de sandbox - só este arquivo deve precisar mudar.
 */

const AUTH_HOST = 'https://auth.ifood.com.br';
const API_HOST = 'https://merchant-api.ifood.com.br';
const DEFAULT_TIMEOUT_MS = 15_000;

function getConfig() {
  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  const callbackUrl = process.env.IFOOD_CALLBACK_URL;

  if (!clientId || !clientSecret || !callbackUrl) {
    throw new Error('Credenciais da iFood não configuradas (IFOOD_CLIENT_ID / IFOOD_CLIENT_SECRET / IFOOD_CALLBACK_URL).');
  }

  return { clientId, clientSecret, callbackUrl };
}

// Mesmo motivo do mercadolivre-client: sem timeout, uma resposta lenta trava
// a chamada inteira (watchdog de polling roda a cada poucos segundos).
async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ ok: boolean; status: number; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = (await response.json().catch(() => ({}))) as T;
    return { ok: response.ok, status: response.status, body };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('A iFood demorou demais pra responder.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function getAuthorizationUrl(state: string) {
  const { clientId, callbackUrl } = getConfig();
  const url = new URL(`${AUTH_HOST}/authentication/v1.0/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);
  return url.toString();
}

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  type: string;
  error?: string;
  message?: string;
};

export async function exchangeCodeForToken(code: string) {
  const { clientId, clientSecret, callbackUrl } = getConfig();
  const { ok, body } = await fetchJson<TokenResponse>(`${AUTH_HOST}/authentication/v1.0/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grantType: 'authorization_code',
      clientId,
      clientSecret,
      code,
      redirectUri: callbackUrl,
    }).toString(),
  });
  if (!ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao trocar code por token na iFood.');
  }
  return body;
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getConfig();
  const { ok, body } = await fetchJson<TokenResponse>(`${AUTH_HOST}/authentication/v1.0/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grantType: 'refresh_token',
      clientId,
      clientSecret,
      refreshToken,
    }).toString(),
  });
  if (!ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao renovar o token da iFood.');
  }
  return body;
}

type MerchantResponse = {
  id: string;
  name: string;
  corporateName?: string;
  error?: string;
  message?: string;
};

// Lista os merchants (lojas) que essa autorização cobre - uma autorização
// pode liberar mais de uma loja, mas o Lucrei conecta uma loja Lucrei por
// merchant, então usa sempre o primeiro da lista.
export async function getMerchants(accessToken: string) {
  const { ok, body } = await fetchJson<MerchantResponse[]>(`${API_HOST}/merchant/v1.0/merchants`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!ok) {
    throw new Error('Falha ao buscar lojas (merchants) na iFood.');
  }
  return body;
}

export type IfoodEvent = {
  id: string;
  orderId: string;
  code: string;
  fullCode?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

// Polling - a iFood não empurra pedido, precisa buscar eventos periodicamente
// (ver ifood-poll-watchdog.ts). Formato de resposta (array direto vs
// {events: [...]}) ainda não confirmado.
export async function getMerchantEvents(accessToken: string, merchantId: string) {
  const { ok, status, body } = await fetchJson<IfoodEvent[]>(
    `${API_HOST}/order/v1.0/events:polling?groups=ALL`,
    { headers: { Authorization: `Bearer ${accessToken}`, 'x-polling-merchants': merchantId } }
  );
  // 204 (sem evento novo) não é erro - só não tem nada pra processar agora.
  if (status === 204) return [];
  if (!ok) {
    throw new Error('Falha ao buscar eventos de pedido na iFood.');
  }
  return body ?? [];
}

// Confirmação obrigatória - sem isso a iFood reenvia o mesmo evento na
// próxima consulta de polling.
export async function acknowledgeEvents(accessToken: string, eventIds: string[]) {
  if (eventIds.length === 0) return;
  await fetchJson(`${API_HOST}/order/v1.0/events/acknowledgment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventIds.map((id) => ({ id }))),
  });
}

export type IfoodOrderItem = {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice?: number;
  discount?: number;
};

type OrderDetailResponse = {
  id?: string;
  displayId?: string;
  orderType?: string;
  createdAt?: string;
  // Status "achatado" vindo do próprio evento de polling (fullCode) é o que
  // o Lucrei realmente guarda em Order.orderStatus - este campo aqui é só
  // referência, quando presente.
  salesChannel?: string;
  items?: IfoodOrderItem[];
  total?: {
    subTotal?: number;
    deliveryFee?: number;
    discount?: number;
    orderAmount?: number;
  };
  error?: string;
  message?: string;
};

export async function getOrder(accessToken: string, orderId: string) {
  const { ok, body } = await fetchJson<OrderDetailResponse>(`${API_HOST}/order/v1.0/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar detalhe do pedido na iFood.');
  }
  return body;
}
