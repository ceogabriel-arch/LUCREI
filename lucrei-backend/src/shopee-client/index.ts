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
