import crypto from 'node:crypto';

/**
 * Cliente da Shopee Open Platform API v2.
 *
 * Formato de assinatura confirmado na documentação oficial (open.shopee.com):
 *   base string = partner_id + path + timestamp [+ access_token + shop_id]
 *   sign = HMAC-SHA256(base_string, partner_key), em hexadecimal
 *
 * O trecho entre colchetes só entra depois que já existe token (chamadas
 * autenticadas). Para a URL de autorização e a troca do code por token,
 * usa-se apenas partner_id + path + timestamp.
 *
 * IMPORTANTE: o path exato de autorização (`/api/v2/shop/auth_partner`) e os
 * domínios de sandbox/produção abaixo vêm de fontes secundárias + conhecimento
 * geral da API — confirme contra o Shopee Partner Center assim que tiver uma
 * conta de parceiro real, antes de ir para produção.
 */

const HOSTS = {
  sandbox: 'https://openplatform.sandbox.test-stable.shopee.sg',
  live: 'https://partner.shopeemobile.com',
} as const;

type ShopeeEnv = keyof typeof HOSTS;

function getConfig() {
  const partnerId = process.env.SHOPEE_PARTNER_ID;
  const partnerKey = process.env.SHOPEE_PARTNER_KEY;
  const callbackUrl = process.env.SHOPEE_CALLBACK_URL;
  const env = (process.env.SHOPEE_ENV as ShopeeEnv) || 'sandbox';

  if (!partnerId || !partnerKey || !callbackUrl) {
    throw new Error(
      'Credenciais da Shopee não configuradas (SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY / SHOPEE_CALLBACK_URL).'
    );
  }

  return { partnerId, partnerKey, callbackUrl, host: HOSTS[env] };
}

function sign(baseString: string, partnerKey: string) {
  return crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

function timestamp() {
  return Math.floor(Date.now() / 1000);
}

export function getAuthorizationUrl(state: string) {
  const { partnerId, partnerKey, callbackUrl, host } = getConfig();
  const path = '/api/v2/shop/auth_partner';
  const ts = timestamp();
  const baseString = `${partnerId}${path}${ts}`;
  const signature = sign(baseString, partnerKey);

  const url = new URL(host + path);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', String(ts));
  url.searchParams.set('sign', signature);
  url.searchParams.set('redirect', `${callbackUrl}?state=${encodeURIComponent(state)}`);

  return url.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expire_in: number;
  error?: string;
  message?: string;
};

export async function exchangeCodeForToken(code: string, shopId: number) {
  const { partnerId, partnerKey, host } = getConfig();
  const path = '/api/v2/auth/token/get';
  const ts = timestamp();
  const baseString = `${partnerId}${path}${ts}`;
  const signature = sign(baseString, partnerKey);

  const url = new URL(host + path);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', String(ts));
  url.searchParams.set('sign', signature);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, shop_id: shopId, partner_id: Number(partnerId) }),
  });

  const body = (await response.json()) as TokenResponse;
  if (!response.ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao trocar code por token na Shopee.');
  }
  return body;
}

export async function refreshAccessToken(refreshToken: string, shopId: number) {
  const { partnerId, partnerKey, host } = getConfig();
  const path = '/api/v2/auth/access_token/get';
  const ts = timestamp();
  const baseString = `${partnerId}${path}${ts}`;
  const signature = sign(baseString, partnerKey);

  const url = new URL(host + path);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', String(ts));
  url.searchParams.set('sign', signature);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken, shop_id: shopId, partner_id: Number(partnerId) }),
  });

  const body = (await response.json()) as TokenResponse;
  if (!response.ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao renovar o token da Shopee.');
  }
  return body;
}

type ShopInfoResponse = {
  shop_name: string;
  region: string;
  status: string;
  error?: string;
  message?: string;
};

export async function getShopInfo(accessToken: string, shopId: number) {
  const url = buildAuthenticatedUrl('/api/v2/shop/get_shop_info', accessToken, shopId);
  const response = await fetch(url);
  const body = (await response.json()) as ShopInfoResponse;
  if (!response.ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar informações da loja na Shopee.');
  }
  return body;
}

type OrderListResponse = {
  response?: {
    order_list: { order_sn: string; order_status: string }[];
    more: boolean;
    next_cursor: string;
  };
  error?: string;
  message?: string;
};

export async function getOrderList(
  accessToken: string,
  shopId: number,
  opts: { timeFrom: number; timeTo: number; cursor?: string }
) {
  let url = buildAuthenticatedUrl('/api/v2/order/get_order_list', accessToken, shopId);
  const params = new URLSearchParams({
    time_range_field: 'create_time',
    time_from: String(opts.timeFrom),
    time_to: String(opts.timeTo),
    page_size: '50',
    cursor: opts.cursor ?? '',
  });
  url += `&${params.toString()}`;

  const response = await fetch(url);
  const body = (await response.json()) as OrderListResponse;
  if (!response.ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar pedidos na Shopee.');
  }
  return body.response!;
}

type OrderDetailResponse = {
  response?: {
    order_list: { order_sn: string; create_time: number }[];
  };
  error?: string;
  message?: string;
};

export async function getOrderDetail(accessToken: string, shopId: number, orderSnList: string[]) {
  let url = buildAuthenticatedUrl('/api/v2/order/get_order_detail', accessToken, shopId);
  const params = new URLSearchParams({
    order_sn_list: orderSnList.join(','),
    response_optional_fields: 'create_time',
  });
  url += `&${params.toString()}`;

  const response = await fetch(url);
  const body = (await response.json()) as OrderDetailResponse;
  if (!response.ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar detalhe do pedido na Shopee.');
  }
  return body.response!.order_list;
}

type EscrowDetailResponse = {
  response?: {
    order_sn: string;
    order_income: {
      escrow_amount: number;
      buyer_paid_shipping_fee: number;
      actual_shipping_fee: number;
      commission_fee: number;
      service_fee: number;
      items: {
        item_id: number;
        model_id: number;
        item_name: string;
        quantity_purchased: number;
        discounted_price: number;
      }[];
    };
  };
  error?: string;
  message?: string;
};

export async function getEscrowDetail(accessToken: string, shopId: number, orderSn: string) {
  let url = buildAuthenticatedUrl('/api/v2/payment/get_escrow_detail', accessToken, shopId);
  url += `&${new URLSearchParams({ order_sn: orderSn }).toString()}`;

  const response = await fetch(url);
  const body = (await response.json()) as EscrowDetailResponse;
  if (!response.ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar detalhe de repasse na Shopee.');
  }
  return body.response!;
}

type ItemListResponse = {
  response?: {
    item: { item_id: number; item_status: string }[];
    total_count: number;
    has_next_page: boolean;
    next_offset: number;
  };
  error?: string;
  message?: string;
};

export async function getItemList(
  accessToken: string,
  shopId: number,
  opts: { offset: number; pageSize: number }
) {
  let url = buildAuthenticatedUrl('/api/v2/product/get_item_list', accessToken, shopId);
  const params = new URLSearchParams({
    offset: String(opts.offset),
    page_size: String(opts.pageSize),
    item_status: 'NORMAL',
  });
  url += `&${params.toString()}`;

  const response = await fetch(url);
  const body = (await response.json()) as ItemListResponse;
  if (!response.ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar catálogo de produtos na Shopee.');
  }
  return body.response!;
}

type ItemBaseInfoResponse = {
  response?: {
    item_list: {
      item_id: number;
      item_name: string;
      item_sku?: string;
      image?: { image_url_list: string[] };
      price_info?: { current_price: number }[];
    }[];
  };
  error?: string;
  message?: string;
};

export async function getItemBaseInfo(accessToken: string, shopId: number, itemIds: number[]) {
  let url = buildAuthenticatedUrl('/api/v2/product/get_item_base_info', accessToken, shopId);
  const params = new URLSearchParams({
    item_id_list: itemIds.join(','),
    response_optional_fields: 'item_name,image,price_info',
  });
  url += `&${params.toString()}`;

  const response = await fetch(url);
  const body = (await response.json()) as ItemBaseInfoResponse;
  if (!response.ok || body.error) {
    throw new Error(body.message || body.error || 'Falha ao buscar detalhes dos produtos na Shopee.');
  }
  return body.response!.item_list;
}

export function buildAuthenticatedUrl(path: string, accessToken: string, shopId: number) {
  const { partnerId, partnerKey, host } = getConfig();
  const ts = timestamp();
  const baseString = `${partnerId}${path}${ts}${accessToken}${shopId}`;
  const signature = sign(baseString, partnerKey);

  const url = new URL(host + path);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', String(ts));
  url.searchParams.set('sign', signature);
  url.searchParams.set('access_token', accessToken);
  url.searchParams.set('shop_id', String(shopId));

  return url.toString();
}
