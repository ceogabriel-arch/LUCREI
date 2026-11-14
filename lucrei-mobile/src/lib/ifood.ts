import { ApiError } from '@/lib/api';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type IfoodLink = {
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  linkToken: string;
};

async function post<T>(path: string, token: string, body?: unknown): Promise<T> {
  if (!API_URL) throw new ApiError('Servidor não configurado.');
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError('Não foi possível conectar ao servidor.');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.message ?? 'Algo deu errado. Tente novamente.', res.status);
  return json as T;
}

// A iFood não tem login por redirecionamento como Shopee/ML: o lojista
// digita este código no Portal do Parceiro e cola de volta o código de
// autorização que o portal mostra (ver lucrei-backend/src/ifood-client).
export function startIfoodLink(token: string) {
  return post<IfoodLink>('/ifood/user-code', token);
}

export function finishIfoodLink(token: string, linkToken: string, authorizationCode: string) {
  return post<{ status: 'success'; shopName: string }>('/ifood/connect', token, { linkToken, authorizationCode });
}
