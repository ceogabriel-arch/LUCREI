import { decrypt, encrypt } from './crypto';
import { prisma } from './prisma';
import { refreshAccessToken, toExpiryDate } from '../tiktokshop-client';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

type TokenResult = { accessToken: string; shopCipher: string };

const inFlightRefreshes = new Map<string, Promise<TokenResult>>();

// Mesmo desenho de mercadolivre-token.ts - a diferença é que toda chamada da
// loja no TikTok Shop também precisa do shopCipher, então ele volta junto.
export async function getValidAccessToken(shopId: string): Promise<TokenResult> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { tiktokShopOAuthToken: true },
  });
  if (!shop.tiktokShopOAuthToken) {
    throw new Error('Loja sem token de acesso salvo.');
  }

  const { shopCipher } = shop.tiktokShopOAuthToken;
  const expiresInMs = shop.tiktokShopOAuthToken.accessTokenExpiresAt.getTime() - Date.now();

  if (expiresInMs > REFRESH_MARGIN_MS) {
    return { accessToken: decrypt(shop.tiktokShopOAuthToken.accessToken), shopCipher };
  }

  const existing = inFlightRefreshes.get(shopId);
  if (existing) return existing;

  const refreshToken = decrypt(shop.tiktokShopOAuthToken.refreshToken);
  const refreshPromise = (async (): Promise<TokenResult> => {
    try {
      const refreshed = await refreshAccessToken(refreshToken);
      // Sempre salva o refresh_token devolvido - não confirmado se o do
      // TikTok Shop roda a cada uso como o do Mercado Livre, e salvar o novo
      // funciona nos dois casos.
      await prisma.tiktokShopOAuthToken.update({
        where: { shopId: shop.id },
        data: {
          accessToken: encrypt(refreshed.access_token),
          refreshToken: encrypt(refreshed.refresh_token),
          accessTokenExpiresAt: toExpiryDate(refreshed.access_token_expire_in, 7 * 24 * 60 * 60),
          refreshTokenExpiresAt: refreshed.refresh_token_expire_in
            ? toExpiryDate(refreshed.refresh_token_expire_in, 0)
            : undefined,
        },
      });
      return { accessToken: refreshed.access_token, shopCipher };
    } finally {
      inFlightRefreshes.delete(shopId);
    }
  })();

  inFlightRefreshes.set(shopId, refreshPromise);
  return refreshPromise;
}
