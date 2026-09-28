import { decrypt, encrypt } from './crypto';
import { prisma } from './prisma';
import { refreshAccessToken } from '../mercadolivre-client';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type TokenResult = { accessToken: string; mercadoLivreUserId: number };

const inFlightRefreshes = new Map<string, Promise<TokenResult>>();

export async function getValidAccessToken(shopId: string): Promise<TokenResult> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { mercadoLivreOAuthToken: true },
  });
  if (!shop.mercadoLivreOAuthToken) {
    throw new Error('Loja sem token de acesso salvo.');
  }

  const mercadoLivreUserId = Number(shop.mercadoLivreShopId);
  const expiresInMs = shop.mercadoLivreOAuthToken.accessTokenExpiresAt.getTime() - Date.now();

  if (expiresInMs > REFRESH_MARGIN_MS) {
    return { accessToken: decrypt(shop.mercadoLivreOAuthToken.accessToken), mercadoLivreUserId };
  }

  const existing = inFlightRefreshes.get(shopId);
  if (existing) return existing;

  const refreshToken = decrypt(shop.mercadoLivreOAuthToken.refreshToken);
  const refreshPromise = (async (): Promise<TokenResult> => {
    try {
      const refreshed = await refreshAccessToken(refreshToken);
      // O refresh_token do Mercado Livre roda uma vez só - o novo (vindo
      // aqui) TEM que substituir o salvo, senão o próximo refresh falha.
      await prisma.mercadoLivreOAuthToken.update({
        where: { shopId: shop.id },
        data: {
          accessToken: encrypt(refreshed.access_token),
          refreshToken: encrypt(refreshed.refresh_token),
          accessTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
        },
      });
      return { accessToken: refreshed.access_token, mercadoLivreUserId };
    } finally {
      inFlightRefreshes.delete(shopId);
    }
  })();

  inFlightRefreshes.set(shopId, refreshPromise);
  return refreshPromise;
}
