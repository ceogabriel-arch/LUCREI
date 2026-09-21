import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { ApiError } from '@/lib/api';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type ConnectShopeeResult = { status: 'success' | 'error' | 'cancelled'; reason?: string };

export async function connectShopeeStore(token: string): Promise<ConnectShopeeResult> {
  if (!API_URL) throw new ApiError('Servidor não configurado.');

  const returnUrl = Linking.createURL('shopee-connected');

  const res = await fetch(
    `${API_URL}/shopee/authorize-url?returnUrl=${encodeURIComponent(returnUrl)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.message ?? 'Não foi possível iniciar a conexão com a Shopee.');
  }

  // Na web, expo-web-browser abre isso num popup de 500x650 por padrão -
  // apertado demais pro fluxo da Shopee (login, SMS, seletor de conta,
  // tela de autorização). Nativo ignora essas opções (usa o browser do
  // sistema), então é seguro passar sempre.
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
