import { createHmac } from 'node:crypto';

/**
 * Cliente da Open API do TikTok Shop (versão 202309).
 *
 * Confirmado em 14/11/2026: o app_key/app_secret são reconhecidos pelo
 * endpoint de token (código falso devolve {"code":36004004,"message":"invalid
 * auth code"}, não erro de app), e os dois endereços de autorização respondem.
 * Assinatura, endpoints de loja/pedido/financeiro e formato das respostas
 * seguem a documentação pública e bibliotecas de terceiros (EcomPHP
 * tiktokshop-php) - NÃO confirmados contra uma loja real ainda. Assim que um
 * vendedor autorizar, conferir os campos marcados como "não confirmado"
 * abaixo; só este arquivo deve precisar mudar.
 *
 * Diferente do Mercado Livre (Bearer simples), toda chamada da API de loja é
 * assinada com HMAC-SHA256 (app_secret como chave) e leva o shop_cipher da
 * loja na query - o token vai no header x-tts-access-token.
 */

const AUTH_HOST = 'https://auth.tiktok-shops.com';
const AUTHORIZE_HOST = 'https://services.tiktokshop.com';
const API_HOST = 'https://open-api.tiktokglobalshop.com';
const DEFAULT_TIMEOUT_MS = 15_000;

function getConfig() {
  const appKey = process.env.TIKTOKSHOP_APP_KEY;
  const appSecret = process.env.TIKTOKSHOP_APP_SECRET;
  const serviceId = process.env.TIKTOKSHOP_SERVICE_ID;

  if (!appKey || !appSecret || !serviceId) {
    throw new Error(
      'Credenciais do TikTok Shop não configuradas (TIKTOKSHOP_APP_KEY / TIKTOKSHOP_APP_SECRET / TIKTOKSHOP_SERVICE_ID).'
    );
  }

  return { appKey, appSecret, serviceId };
}

// Mesmo motivo do mercadolivre-client: sem timeout, uma resposta lenta trava
// a chamada inteira (e o watchdog de sync roda em lote).
async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ ok: boolean; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = (await response.json().catch(() => ({}))) as T;
    return { ok: response.ok, body };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('O TikTok Shop demorou demais pra responder.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

type Envelope<T> = { code: number; message?: string; request_id?: string; data?: T };

function unwrap<T>(body: Envelope<T>, fallback: string): T {
  if (body.code !== 0 || body.data === undefined) {
    throw new Error(body.message ? `${fallback} (${body.message})` : fallback);
  }
  return body.data;
}

export function getAuthorizationUrl(state: string) {
  const { serviceId } = getConfig();
  const url = new URL(`${AUTHORIZE_HOST}/open/authorize`);
  url.searchParams.set('service_id', serviceId);
  url.searchParams.set('state', state);
  return url.toString();
}

export type TokenData = {
  access_token: string;
  // Não confirmado: a documentação descreve os dois "expire_in" como
  // timestamp Unix (segundos) de quando vence, não como duração - ver
  // toExpiryDate, que aceita os dois formatos.
  access_token_expire_in: number;
  refresh_token: string;
  refresh_token_expire_in?: number;
  open_id?: string;
  seller_name?: string;
};

// Aceita tanto timestamp Unix (o que a documentação descreve) quanto duração
// em segundos - qualquer valor abaixo de ~2001 em epoch só pode ser duração.
export function toExpiryDate(expireIn: number | undefined, fallbackSeconds: number) {
  if (!expireIn || !Number.isFinite(expireIn)) return new Date(Date.now() + fallbackSeconds * 1000);
  if (expireIn > 1_000_000_000) return new Date(expireIn * 1000);
  return new Date(Date.now() + expireIn * 1000);
}

export async function exchangeCodeForToken(code: string) {
  const { appKey, appSecret } = getConfig();
  const url = new URL(`${AUTH_HOST}/api/v2/token/get`);
  url.search = new URLSearchParams({ app_key: appKey, app_secret: appSecret, auth_code: code, grant_type: 'authorized_code' }).toString();
  const { body } = await fetchJson<Envelope<TokenData>>(url.toString());
  return unwrap(body, 'Falha ao trocar code por token no TikTok Shop.');
}

// Não confirmado se o refresh_token do TikTok Shop roda a cada uso (como o
// do Mercado Livre) ou é reutilizável (como o da Shopee) - quem chama sempre
// salva o refresh_token que vier na resposta, o que funciona nos dois casos.
export async function refreshAccessToken(refreshToken: string) {
  const { appKey, appSecret } = getConfig();
  const url = new URL(`${AUTH_HOST}/api/v2/token/refresh`);
  url.search = new URLSearchParams({ app_key: appKey, app_secret: appSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString();
  const { body } = await fetchJson<Envelope<TokenData>>(url.toString());
  return unwrap(body, 'Falha ao renovar o token do TikTok Shop.');
}

// Assinatura: HMAC-SHA256 (chave = app_secret) sobre
// app_secret + path + params ordenados (chave+valor, sem sign/access_token)
// + corpo JSON (só fora de GET) + app_secret, em hex minúsculo. Nunca logar a
// string assinada - ela contém o app_secret.
export function signRequest(path: string, query: Record<string, string>, body: string, appSecret: string) {
  const params = Object.keys(query)
    .filter((k) => k !== 'sign' && k !== 'access_token')
    .sort()
    .map((k) => `${k}${query[k]}`)
    .join('');
  return createHmac('sha256', appSecret).update(`${appSecret}${path}${params}${body}${appSecret}`).digest('hex');
}

type ApiCall = {
  method: 'GET' | 'POST';
  path: string;
  accessToken: string;
  shopCipher?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

async function callApi<T>({ method, path, accessToken, shopCipher, query, body }: ApiCall, fallback: string): Promise<T> {
  const { appKey, appSecret } = getConfig();
  const params: Record<string, string> = { app_key: appKey, timestamp: String(Math.floor(Date.now() / 1000)) };
  if (shopCipher) params.shop_cipher = shopCipher;
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) params[k] = String(v);
  }
  const bodyString = method === 'GET' ? '' : JSON.stringify(body ?? {});
  params.sign = signRequest(path, params, bodyString, appSecret);

  const { body: response } = await fetchJson<Envelope<T>>(`${API_HOST}${path}?${new URLSearchParams(params).toString()}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-tts-access-token': accessToken },
    body: method === 'GET' ? undefined : bodyString,
  });
  return unwrap(response, fallback);
}

export type AuthorizedShop = { id: string; name: string; region: string; cipher: string; code?: string };

// Única chamada da loja SEM shop_cipher - é justamente ela que devolve o
// cipher de cada loja autorizada.
export async function getAuthorizedShops(accessToken: string) {
  const data = await callApi<{ shops?: AuthorizedShop[] }>(
    { method: 'GET', path: '/authorization/202309/shops', accessToken },
    'Falha ao buscar lojas autorizadas no TikTok Shop.'
  );
  return data.shops ?? [];
}

// Formato não confirmado contra pedido real. Pela documentação, valores
// monetários vêm como string e cada line_item é UMA unidade (um pedido com 3
// unidades do mesmo SKU traz 3 line_items) - ver tiktokshop-order-math.ts,
// que agrupa por produto/SKU e também aceita um "quantity" se vier.
export type TiktokLineItem = {
  id: string;
  product_id: string;
  product_name?: string;
  sku_id?: string;
  sku_name?: string;
  sale_price?: string;
  original_price?: string;
  quantity?: number;
};

export type TiktokOrder = {
  id: string;
  status: string;
  create_time?: number;
  update_time?: number;
  paid_time?: number;
  payment?: {
    currency?: string;
    sub_total?: string;
    shipping_fee?: string;
    total_amount?: string;
  };
  line_items?: TiktokLineItem[];
};

export async function searchOrders(
  accessToken: string,
  shopCipher: string,
  params: { pageSize: number; pageToken?: string; updateTimeGe?: number; updateTimeLt?: number }
) {
  return callApi<{ orders?: TiktokOrder[]; next_page_token?: string; total_count?: number }>(
    {
      method: 'POST',
      path: '/order/202309/orders/search',
      accessToken,
      shopCipher,
      query: { page_size: params.pageSize, page_token: params.pageToken || undefined },
      body: { update_time_ge: params.updateTimeGe, update_time_lt: params.updateTimeLt },
    },
    'Falha ao buscar pedidos no TikTok Shop.'
  );
}

export async function getOrders(accessToken: string, shopCipher: string, orderIds: string[]) {
  const data = await callApi<{ orders?: TiktokOrder[] }>(
    { method: 'GET', path: '/order/202309/orders', accessToken, shopCipher, query: { ids: orderIds.join(',') } },
    'Falha ao buscar detalhe do pedido no TikTok Shop.'
  );
  return data.orders ?? [];
}

export async function getOrder(accessToken: string, shopCipher: string, orderId: string) {
  const [order] = await getOrders(accessToken, shopCipher, [orderId]);
  if (!order) throw new Error('Pedido não encontrado no TikTok Shop.');
  return order;
}

// Formato não confirmado. A documentação descreve transações de extrato por
// pedido com valores em string, entre eles a taxa da plataforma e o custo de
// frete do vendedor - e o extrato só existe depois do repasse, então pedido
// recente costuma não ter nada aqui ainda.
export type TiktokStatementTransaction = {
  revenue_amount?: string;
  settlement_amount?: string;
  fee_amount?: string;
  shipping_cost_amount?: string;
};

export async function getOrderStatementTransactions(accessToken: string, shopCipher: string, orderId: string) {
  const data = await callApi<{ statement_transactions?: TiktokStatementTransaction[] }>(
    { method: 'GET', path: `/finance/202309/orders/${orderId}/statement_transactions`, accessToken, shopCipher },
    'Falha ao buscar extrato do pedido no TikTok Shop.'
  );
  return data.statement_transactions ?? [];
}
