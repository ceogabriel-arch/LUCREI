import { decrypt, encrypt } from './crypto';
import { prisma } from './prisma';
import { refreshAccessToken } from '../ifood-client';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type TokenResult = { accessToken: string; merchantId: string };

const inFlightRefreshes = new Map<string, Promise<TokenResult>>();

export async function getValidAccessToken(shopId: string): Promise<TokenResult> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { ifoodOAuthToken: true },
  });
  if (!shop.ifoodOAuthToken) {
    throw new Error('Loja sem token de acesso salvo.');
  }

  const merchantId = shop.ifoodOAuthToken.merchantId;
  const expiresInMs = shop.ifoodOAuthToken.accessTokenExpiresAt.getTime() - Date.now();

  if (expiresInMs > REFRESH_MARGIN_MS) {
    return { accessToken: decrypt(shop.ifoodOAuthToken.accessToken), merchantId };
  }

  const existing = inFlightRefreshes.get(shopId);
  if (existing) return existing;

  const refreshToken = decrypt(shop.ifoodOAuthToken.refreshToken);
  const refreshPromise = (async (): Promise<TokenResult> => {
    try {
      const refreshed = await refreshAccessToken(refreshToken);
      await prisma.ifoodOAuthToken.update({
        where: { shopId: shop.id },
        data: {
          accessToken: encrypt(refreshed.accessToken),
          refreshToken: encrypt(refreshed.refreshToken),
          accessTokenExpiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        },
      });
      return { accessToken: refreshed.accessToken, merchantId };
    } finally {
      inFlightRefreshes.delete(shopId);
    }
  })();

  inFlightRefreshes.set(shopId, refreshPromise);
  return refreshPromise;
}
