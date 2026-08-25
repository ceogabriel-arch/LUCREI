import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

import { ApiError } from '@/lib/api';

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export type ConnectShopeeResult = { status: 'success' | 'error' | 'cancelled' };

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

  const result = await WebBrowser.openAuthSessionAsync(body.url, returnUrl);
  if (result.type !== 'success') {
    return { status: 'cancelled' };
  }

  const { queryParams } = Linking.parse(result.url);
  return { status: queryParams?.status === 'success' ? 'success' : 'error' };
}
