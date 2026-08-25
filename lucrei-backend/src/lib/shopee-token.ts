import { refreshAccessToken } from '../shopee-client';
import { prisma } from './prisma';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getValidAccessToken(shopId: string) {
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
    return { accessToken: shop.oauthToken.accessToken, shopeeShopId };
  }

  const refreshed = await refreshAccessToken(shop.oauthToken.refreshToken, shopeeShopId);
  const now = Date.now();
  await prisma.shopeeOAuthToken.update({
    where: { shopId: shop.id },
    data: {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      accessTokenExpiresAt: new Date(now + refreshed.expire_in * 1000),
      refreshTokenExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken: refreshed.access_token, shopeeShopId };
}
