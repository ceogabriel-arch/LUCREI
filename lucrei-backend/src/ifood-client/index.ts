/**
 * Cliente da API de parceiros da iFood, modelo de app DISTRIBUÍDO.
 * Confirmado contra a loja de teste em 14/11/2026 (userCode, troca do
 * authorizationCode, refresh, merchants e polling).
 *
 * A iFood não tem login por redirecionamento como Shopee/ML: o Lucrei pede
 * um código de vínculo (userCode), o lojista digita esse código no Portal do
 * Parceiro ("Ativar integração por código"), recebe um authorizationCode e
 * cola de volta no Lucrei, que troca pelo token junto com o
 * authorizationCodeVerifier devolvido no primeiro passo.
 */

const API_HOST = 'https://merchant-api.ifood.com.br';
const DEFAULT_TIMEOUT_MS = 15_000;

function getConfig() {
  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Credenciais da iFood não configuradas (IFOOD_CLIENT_ID / IFOOD_CLIENT_SECRET).');
  }

  return { clientId, clientSecret };
}

// Erro da iFood vem como { error: { code, message } } - não string solta.
function ifoodErrorMessage(body: { error?: unknown; message?: string }, fallback: string) {
  if (body.error && typeof body.error === 'object' && 'message' in body.error) {
    return String((body.error as { message: unknown }).message);
  }
  if (typeof body.error === 'string') return body.error;
  return body.message || fallback;
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

type UserCodeResponse = {
  userCode: string;
  authorizationCodeVerifier: string;
  verificationUrl: string;
  verificationUrlComplete: string;
  expiresIn: number;
  error?: unknown;
  message?: string;
};

// Passo 1 do vínculo: código curto (ex. "MVFJ-SSTV", vale 10 min) que o
// lojista digita no Portal do Parceiro. O verifier nunca vai pro lojista em
// texto puro - o backend guarda (cifrado) até o passo 2.
export async function requestUserCode() {
  const { clientId } = getConfig();
  const { ok, body } = await fetchJson<UserCodeResponse>(`${API_HOST}/authentication/v1.0/oauth/userCode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ clientId }).toString(),
  });
  if (!ok || !body.userCode) {
    throw new Error(ifoodErrorMessage(body, 'Falha ao gerar código de vínculo na iFood.'));
  }
  return body;
}

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  type: string;
  error?: unknown;
  message?: string;
};

export class IfoodAuthorizationCodeError extends Error {}

// Passo 2: authorizationCode (vale 5 min) que o Portal do Parceiro mostrou
// depois do lojista aprovar o código de vínculo.
export async function exchangeAuthorizationCode(authorizationCode: string, authorizationCodeVerifier: string) {
  const { clientId, clientSecret } = getConfig();
  const { ok, status, body } = await fetchJson<TokenResponse>(`${API_HOST}/authentication/v1.0/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grantType: 'authorization_code',
      clientId,
      clientSecret,
      authorizationCode,
      authorizationCodeVerifier,
    }).toString(),
  });
  if (!ok || !body.accessToken) {
    const message = ifoodErrorMessage(body, 'Falha ao trocar o código de autorização na iFood.');
    // 4xx = código errado/vencido (culpa do que foi colado); 5xx/timeout =
    // falha passageira da iFood - a rota mostra mensagens diferentes.
    if (status >= 400 && status < 500) throw new IfoodAuthorizationCodeError(message);
    throw new Error(message);
  }
  return body;
}

// 4xx no refresh = autorização revogada/vencida, não adianta tentar de novo
// (ver IFOOD_RECONNECT_MESSAGE em lib/ifood-token.ts).
export class IfoodRefreshRejectedError extends Error {}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getConfig();
  const { ok, status, body } = await fetchJson<TokenResponse>(`${API_HOST}/authentication/v1.0/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grantType: 'refresh_token',
      clientId,
      clientSecret,
      refreshToken,
    }).toString(),
  });
  if (!ok || !body.accessToken) {
    const message = ifoodErrorMessage(body, 'Falha ao renovar o token da iFood.');
    if (status >= 400 && status < 500) throw new IfoodRefreshRejectedError(message);
    throw new Error(message);
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
// (ver ifood-poll-watchdog.ts). Sem "?groups=ALL": esse parâmetro dá 400 na
// API atual. Formato da resposta com evento (array direto vs
// {events: [...]}) ainda não confirmado - a loja de teste só devolveu 204.
export async function getMerchantEvents(accessToken: string, merchantId: string) {
  const { ok, status, body } = await fetchJson<IfoodEvent[]>(
    `${API_HOST}/order/v1.0/events:polling`,
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
  // Falha aqui só faz a iFood reenviar (reprocessar é idempotente), mas
  // fica no log pra não passar despercebido.
  const { ok, status } = await fetchJson(`${API_HOST}/order/v1.0/events/acknowledgment`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(eventIds.map((id) => ({ id }))),
  });
  if (!ok) {
    console.error('[ifood] acknowledgment não confirmado', { status, events: eventIds.length });
  }
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
  error?: unknown;
  message?: string;
};

export async function getOrder(accessToken: string, orderId: string) {
  const { ok, body } = await fetchJson<OrderDetailResponse>(`${API_HOST}/order/v1.0/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!ok || body.error) {
    throw new Error(ifoodErrorMessage(body, 'Falha ao buscar detalhe do pedido na iFood.'));
  }
  return body;
}
