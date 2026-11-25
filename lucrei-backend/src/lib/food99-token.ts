import { decrypt, encrypt } from './crypto';
import { prisma } from './prisma';
import { getAuthToken, refreshAuthToken } from '../food99-client';

const REFRESH_MARGIN_MS = 10 * 60 * 1000;

const inFlightRefreshes = new Map<string, Promise<string>>();

// Diferente de iFood/ML (refresh devolve token novo direto), a 99Food separa
// em 2 chamadas: refresh (só confirma, cooldown de 2min) e getAuthToken de
// novo (pra pegar o valor atualizado) - ver food99-client/index.ts.
export async function getValidAuthToken(shopId: string): Promise<string> {
  const shop = await prisma.shop.findUniqueOrThrow({
    where: { id: shopId },
    include: { food99OAuthToken: true },
  });
  if (!shop.food99OAuthToken) {
    throw new Error('Loja sem auth_token da 99Food salvo.');
  }

  const expiresInMs = shop.food99OAuthToken.authTokenExpiresAt.getTime() - Date.now();
  if (expiresInMs > REFRESH_MARGIN_MS) {
    return decrypt(shop.food99OAuthToken.authToken);
  }

  const existing = inFlightRefreshes.get(shopId);
  if (existing) return existing;

  // app_shop_id sempre é o próprio Shop.id (ver food99-client/index.ts) -
  // shop.food99ShopId guarda outra coisa (o shop_id da PRÓPRIA 99Food, só
  // usado pra detectar loja duplicada em routes.ts).
  const appShopId = shop.id;
  const refreshPromise = (async (): Promise<string> => {
    try {
      await refreshAuthToken(appShopId);
      const fresh = await getAuthToken(appShopId);
      await prisma.food99OAuthToken.update({
        where: { shopId },
        data: { authToken: encrypt(fresh.authToken), authTokenExpiresAt: fresh.expiresAt },
      });
      return fresh.authToken;
    } finally {
      inFlightRefreshes.delete(shopId);
    }
  })();

  inFlightRefreshes.set(shopId, refreshPromise);
  return refreshPromise;
}
