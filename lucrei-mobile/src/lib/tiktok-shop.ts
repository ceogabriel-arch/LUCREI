import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { ApiError } from '@/lib/api';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type ConnectTiktokShopResult = { status: 'success' | 'error' | 'cancelled'; reason?: string };

// Mesmo fluxo do Mercado Livre (lib/mercado-livre.ts): o vendedor autoriza na
// tela do TikTok Shop e volta pro app por redirecionamento.
export async function connectTiktokShopStore(token: string): Promise<ConnectTiktokShopResult> {
  if (!API_URL) throw new ApiError('Servidor não configurado.');

  const returnUrl = Linking.createURL('tiktokshop-connected');

  const res = await fetch(`${API_URL}/tiktokshop/authorize-url?returnUrl=${encodeURIComponent(returnUrl)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.message ?? 'Não foi possível iniciar a conexão com o TikTok Shop.');
  }

  const result = await WebBrowser.openAuthSessionAsync(body.url, returnUrl, {
    windowFeatures: { width: 620, height: 820 },
  });
  if (result.type !== 'success') {
    return { status: 'cancelled' };
  }

  const { queryParams } = Linking.parse(result.url);
  if (queryParams?.status === 'success') return { status: 'success' };
  return { status: 'error', reason: typeof queryParams?.reason === 'string' ? queryParams.reason : undefined };
}
