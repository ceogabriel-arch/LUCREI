/**
 * Cliente da API da 99Food (plataforma de delivery da 99/DiDi), loja tipo
 * "Mercado". Baseado na documentação lida em 25/11/2026
 * (developer-food.99app.com/pt-BR/openapi > Food > 99Food Protocol) - ainda
 * NÃO confirmado contra um pedido real de sandbox. Pontos assumidos (ajustar
 * assim que testarmos):
 * - O endpoint de confirmar pedido é "/v1/order/order/confirm" com o mesmo
 *   formato {auth_token, order_id} de "/v1/order/order/finish" (Confirm Order
 *   Pickup), que está documentado - não chamamos esse endpoint (ver
 *   food99-service.ts: Lucrei não aceita pedido, só observa).
 *
 * Diferente de Shopee/ML/iFood/TikTok: não há OAuth por usuário. A loja é
 * "vinculada" (bind) ao app com um app_shop_id que o PRÓPRIO Lucrei escolhe
 * (usamos o Shop.id) - depois disso, qualquer chamada busca um auth_token
 * novo via app_id+app_secret+app_shop_id, sem token de usuário envolvido.
 */

import crypto from 'node:crypto';
import jsonBigint from 'json-bigint';

const API_HOST = 'https://openapi.99food.com';
const DEFAULT_TIMEOUT_MS = 15_000;

const parseBigSafe = jsonBigint({ storeAsString: true });

function getConfig() {
  const appId = process.env.FOOD99_APP_ID;
  const appSecret = process.env.FOOD99_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error('Credenciais da 99Food não configuradas (FOOD99_APP_ID / FOOD99_APP_SECRET).');
  }
  return { appId, appSecret };
}

// Mesmo mecanismo descrito em "Authentication & Signature Mechanism": ordena
// os parâmetros por chave (A-Z), monta "chave=valor&chave=valor...", acrescenta
// o app_secret no final e aplica MD5. Usado pelos endpoints v3 (Bind
// Store/List Authorized Stores) - os endpoints v1 (Get/Refresh Authtoken)
// autenticam só com app_secret em claro, sem essa assinatura.
function signParams(params: Record<string, string | number>, appSecret: string): string {
  const keys = Object.keys(params).sort();
  const toSign = keys.map((k) => `${k}=${params[k]}`).join('&') + appSecret;
  return crypto.createHash('md5').update(toSign).digest('hex');
}

// Resposta vem como texto (pra poder reparsear com json-bigint, preservando
// order_id/shop_id de 64 bits sem perder precisão - um JSON.parse comum
// arredonda esses números, ver aviso repetido em toda a documentação).
async function fetchJsonBig<T>(url: string, init?: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ ok: boolean; status: number; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: T;
    try {
      body = parseBigSafe.parse(text) as T;
    } catch {
      body = {} as T;
    }
    return { ok: response.ok, status: response.status, body };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('A 99Food demorou demais pra responder.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

type ApiEnvelope<T> = { errno: number; errmsg: string; data: T };

function unwrap<T>(body: ApiEnvelope<T>, fallback: string): T {
  if (body.errno !== 0) {
    throw new Error(`${fallback} (errno ${body.errno}: ${body.errmsg})`);
  }
  return body.data;
}

// Passo 1 do vínculo: URL genérica do app (não carrega app_shop_id nenhum -
// quem escolhe a loja é o próprio lojista depois de logar). Válida por 7
// dias. Depois de autorizar, a loja fica "autorizada mas não vinculada" -
// usar listUnboundAuthorizedShops + bindShop pra completar.
export async function getAuthorizationUrl(): Promise<string> {
  const { appId } = getConfig();
  const { ok, body } = await fetchJsonBig<ApiEnvelope<{ url: string }>>(
    `${API_HOST}/v1/auth/authorizationpage/getUrl`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId }),
    }
  );
  if (!ok) throw new Error('Falha ao gerar URL de autorização da 99Food.');
  return unwrap(body, 'Falha ao gerar URL de autorização da 99Food').url;
}

export type Food99AuthorizedShop = {
  shop_id: string;
  shop_name: string;
  app_shop_id?: string;
  bound_flag: number;
};

// Lista as lojas autorizadas pro app (em todas as contas Lucrei - a 99Food
// não separa por usuário), paginada. Usado pra descobrir qual loja o lojista
// acabou de autorizar (bound_flag=0) depois que ele volta pro Lucrei.
// ATENÇÃO: endpoint de acesso controlado segundo a documentação - pode
// precisar de liberação da 99Food antes de funcionar.
export async function listAuthorizedShops(pageNo = 1, pageSize = 50): Promise<{ shops: Food99AuthorizedShop[]; totalPages: number }> {
  const { appId, appSecret } = getConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { app_id: appId, timestamp, page_no: pageNo, page_size: pageSize };
  const sign = signParams(params, appSecret);

  const { ok, body } = await fetchJsonBig<ApiEnvelope<{ shops: Food99AuthorizedShop[]; total_page: number }>>(
    `${API_HOST}/v3/auth/authorization/getAuthorizedShops`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, sign }),
    }
  );
  if (!ok) throw new Error('Falha ao listar lojas autorizadas na 99Food.');
  const data = unwrap(body, 'Falha ao listar lojas autorizadas na 99Food');
  return { shops: data.shops ?? [], totalPages: data.total_page ?? 1 };
}

export type Food99BindResult = { shopId: string; appShopId: string; authToken: string; authTokenExpiresAt: Date };

// Passo 2 do vínculo: dado o shop_id (interno da 99Food, achado via
// listAuthorizedShops) e o app_shop_id que o Lucrei escolhe (usamos o
// próprio Shop.id), devolve o auth_token já pronto - não precisa chamar
// getAuthToken depois. ATENÇÃO: "Production Environment Only" segundo a
// documentação - não deve funcionar com o app ainda em Ambiente de teste.
export async function bindShop(food99ShopId: string, appShopId: string): Promise<Food99BindResult> {
  const { appId, appSecret } = getConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const shopInfoStr = JSON.stringify([{ shop_id: food99ShopId, app_shop_id: appShopId }]);
  const params = { app_id: appId, timestamp, shop_infos: shopInfoStr };
  const sign = signParams(params, appSecret);

  const { ok, body } = await fetchJsonBig<
    ApiEnvelope<{
      success_list: { shop_id: string; app_shop_id: string; auth_token: string; token_expiration_time: number }[];
      failure_list: { shop_id: string; app_shop_id: string; reason: string }[];
    }>
  >(`${API_HOST}/v3/auth/authorization/shopBind`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, timestamp, sign, shop_infos: [{ shop_id: food99ShopId, app_shop_id: appShopId }] }),
  });
  if (!ok) throw new Error('Falha ao vincular loja na 99Food.');
  const data = unwrap(body, 'Falha ao vincular loja na 99Food');

  const success = data.success_list?.[0];
  if (!success) {
    const reason = data.failure_list?.[0]?.reason ?? 'motivo desconhecido';
    throw new Error(`A 99Food recusou o vínculo da loja: ${reason}`);
  }
  return {
    shopId: success.shop_id,
    appShopId: success.app_shop_id,
    authToken: success.auth_token,
    authTokenExpiresAt: new Date(success.token_expiration_time * 1000),
  };
}

type AuthTokenResponse = { app_id: string; app_shop_id: string; auth_token: string; token_expiration_time: number };

export async function getAuthToken(appShopId: string): Promise<{ authToken: string; expiresAt: Date }> {
  const { appId, appSecret } = getConfig();
  const qs = new URLSearchParams({ app_id: appId, app_secret: appSecret, app_shop_id: appShopId });
  const { ok, body } = await fetchJsonBig<ApiEnvelope<AuthTokenResponse>>(`${API_HOST}/v1/auth/authtoken/get?${qs.toString()}`);
  if (!ok) throw new Error('Falha ao buscar auth_token da 99Food.');
  const data = unwrap(body, 'Falha ao buscar auth_token da 99Food');
  return { authToken: data.auth_token, expiresAt: new Date(data.token_expiration_time * 1000) };
}

// Só confirma que a renovação começou - não devolve o token novo (cooldown
// de 2min). Chamar getAuthToken de novo depois pra pegar o valor atualizado.
export async function refreshAuthToken(appShopId: string): Promise<void> {
  const { appId, appSecret } = getConfig();
  const qs = new URLSearchParams({ app_id: appId, app_secret: appSecret, app_shop_id: appShopId });
  const { ok, body } = await fetchJsonBig<ApiEnvelope<boolean>>(`${API_HOST}/v1/auth/authtoken/refresh?${qs.toString()}`);
  if (!ok) throw new Error('Falha ao renovar auth_token da 99Food.');
  unwrap(body, 'Falha ao renovar auth_token da 99Food');
}

export type Food99OrderItem = {
  app_item_id: string;
  name: string;
  total_price: number;
  sku_price: number;
  amount: number;
  real_price: number;
};

export type Food99OrderInfo = {
  order_id: string;
  status: number;
  delivery_type?: number;
  create_time: number;
  complete_time?: number;
  price: {
    order_price: number;
    real_price?: number;
    real_pay_price?: number;
    delivery_price?: number;
    refund_price?: number;
    customer_need_paying_money?: number;
  };
  shop: { shop_id: string; app_shop_id: string; shop_name: string };
  order_items: Food99OrderItem[];
};

// O payload do webhook orderNew já traz esse mesmo formato embutido (ver
// food99-service.ts) - essa função só é chamada quando precisamos reconsultar
// (ex.: pedido perdido, backfill manual).
export async function getOrderDetail(authToken: string, orderId: string): Promise<Food99OrderInfo> {
  const qs = new URLSearchParams({ auth_token: authToken, order_id: orderId });
  const { ok, body } = await fetchJsonBig<ApiEnvelope<{ order_id: string; order_info: Food99OrderInfo }>>(
    `${API_HOST}/v1/order/order/detail?${qs.toString()}`
  );
  if (!ok) throw new Error('Falha ao buscar detalhe do pedido na 99Food.');
  return unwrap(body, 'Falha ao buscar detalhe do pedido na 99Food').order_info;
}

export type Food99BillRow = {
  orderId: string;
  orderType: number;
  commissionAmount: number;
  b2pDeliveryAmount: number;
  payCommissionAmount: number;
  vatAmount: number;
  settlementAmount: number;
};

// Token separado (JWT, 6h) só pra Financial API - não é o auth_token da
// loja. É por app (não por loja), dá pra cachear em memória entre lojas.
let financialTokenCache: { accessToken: string; expiresAt: number } | null = null;

async function getFinancialAccessToken(): Promise<string> {
  if (financialTokenCache && financialTokenCache.expiresAt > Date.now() + 60_000) {
    return financialTokenCache.accessToken;
  }
  const { appId, appSecret } = getConfig();
  const { ok, body } = await fetchJsonBig<{ accessToken: string; expiresIn: number }>(
    `${API_HOST}/v3/auth/authtoken/signIn`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retailer: appId, secret: appSecret }),
    }
  );
  if (!ok || !body.accessToken) throw new Error('Falha ao autenticar na API financeira da 99Food.');
  financialTokenCache = { accessToken: body.accessToken, expiresAt: Date.now() + body.expiresIn * 1000 };
  return body.accessToken;
}

// Comissão/repasse real por pedido - a 99Food não manda isso no pedido em si
// (diferente do sale_fee da Shopee/ML), só nessa consulta por período
// (máximo 31 dias por chamada, até 3 meses pro passado). appShopId aqui é o
// mesmo valor usado no bind (acceptor_code).
export async function getBillData(appShopId: string, startDate: string, endDate: string, pageNo = 1): Promise<{ rows: Food99BillRow[]; totalPages: number }> {
  const accessToken = await getFinancialAccessToken();
  const { ok, body } = await fetchJsonBig<{
    errno: number;
    errmsg: string;
    total_page: number;
    data: {
      orderId: string;
      orderType: number;
      commissionAmount?: number;
      b2pDeliveryAmount?: number;
      payCommissionAmount?: number;
      vatAmount?: number;
      settlementAmount?: number;
    }[];
  }>(`${API_HOST}/v3/finance/finance/getShopBillDetail`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ acceptor_code: appShopId, page_no: pageNo, page_size: 200, start_date: startDate, end_date: endDate }),
  });
  if (!ok || body.errno !== 0) throw new Error(`Falha ao buscar dados financeiros da 99Food (errno ${body.errno ?? '?'}).`);

  const rows = (body.data ?? []).map((row) => ({
    orderId: row.orderId,
    orderType: row.orderType,
    commissionAmount: Math.abs(row.commissionAmount ?? 0),
    b2pDeliveryAmount: Math.abs(row.b2pDeliveryAmount ?? 0),
    payCommissionAmount: Math.abs(row.payCommissionAmount ?? 0),
    vatAmount: Math.abs(row.vatAmount ?? 0),
    settlementAmount: row.settlementAmount ?? 0,
  }));
  return { rows, totalPages: body.total_page ?? 1 };
}

// Verificação de assinatura de webhook: MD5(corpo bruto + app_secret) tem
// que bater com o header "didi-header-sign".
export function verifyWebhookSignature(rawBody: string, headerSign: string | undefined): boolean {
  if (!headerSign) return false;
  const { appSecret } = getConfig();
  const expected = crypto.createHash('md5').update(rawBody + appSecret).digest('hex');
  return expected === headerSign;
}

export { parseBigSafe };
