import { decrypt, encrypt } from './crypto';
import { prisma } from './prisma';
import { IfoodRefreshRejectedError, refreshAccessToken } from '../ifood-client';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

// Gravado em Shop.syncError quando a iFood recusa o refresh (lojista removeu
// o app no Portal do Parceiro, ou o refresh token venceu) - o
// ifood-poll-watchdog pula a loja enquanto isso estiver lá, em vez de
// tentar de novo a cada 30s pra sempre. Reconectar limpa.
export const IFOOD_RECONNECT_MESSAGE =
  'A autorização da iFood foi removida ou venceu. Reconecte a loja pelo "Conectar marketplace".';

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
      let refreshed;
      try {
        refreshed = await refreshAccessToken(refreshToken);
      } catch (err) {
        if (err instanceof IfoodRefreshRejectedError) {
          await prisma.shop.update({
            where: { id: shop.id },
            data: { syncStatus: 'error', syncError: IFOOD_RECONNECT_MESSAGE },
          });
          throw new Error(IFOOD_RECONNECT_MESSAGE);
        }
        throw err;
      }
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
