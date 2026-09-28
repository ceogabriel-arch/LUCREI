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
