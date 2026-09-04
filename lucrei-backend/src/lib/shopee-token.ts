import { decrypt, encrypt } from './crypto';
import { prisma } from './prisma';
import { refreshAccessToken } from '../shopee-client';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type TokenResult = { accessToken: string; shopeeShopId: number };

const inFlightRefreshes = new Map<string, Promise<TokenResult>>();

export async function getValidAccessToken(shopId: string): Promise<TokenResult> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { oauthToken: true },
  });
  if (!shop.oauthToken) {
    throw new Error('Loja sem token de acesso salvo.');
  }

  const shopeeShopId = Number(shop.shopeeShopId);
  const expiresInMs = shop.oauthToken.accessTokenExpiresAt.getTime() - Date.now();

  if (expiresInMs > REFRESH_MARGIN_MS) {
    return { accessToken: decrypt(shop.oauthToken.accessToken), shopeeShopId };
  }

  const existing = inFlightRefreshes.get(shopId);
  if (existing) return existing;

  const refreshToken = decrypt(shop.oauthToken.refreshToken);
  const refreshPromise = (async (): Promise<TokenResult> => {
    try {
      const refreshed = await refreshAccessToken(refreshToken, shopeeShopId);
      const now = Date.now();
      await prisma.shopeeOAuthToken.update({
        where: { shopId: shop.id },
        data: {
          accessToken: encrypt(refreshed.access_token),
          refreshToken: encrypt(refreshed.refresh_token),
          accessTokenExpiresAt: new Date(now + refreshed.expire_in * 1000),
          refreshTokenExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        },
      });
      return { accessToken: refreshed.access_token, shopeeShopId };
    } finally {
      inFlightRefreshes.delete(shopId);
    }
  })();

  inFlightRefreshes.set(shopId, refreshPromise);
  return refreshPromise;
}
