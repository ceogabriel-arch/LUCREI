import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { exchangeCodeForToken, getAuthorizationUrl, getShopInfo } from '../../shopee-client';

type CallbackQuery = {
  code?: string;
  shop_id?: string;
  state?: string;
};

export async function shopRoutes(app: FastifyInstance) {
  app.get('/shopee/authorize-url', { onRequest: [app.authenticate] }, async (request) => {
    const state = app.jwt.sign({ sub: request.user.sub }, { expiresIn: '15m' });
    const url = getAuthorizationUrl(state);
    return { url };
  });

  app.get<{ Querystring: CallbackQuery }>('/shopee/callback', async (request, reply) => {
    const appScheme = process.env.APP_SCHEME || 'lucreimobile';
    const { code, shop_id: shopIdRaw, state } = request.query;

    if (!code || !shopIdRaw || !state) {
      return reply.redirect(`${appScheme}://shopee-connected?status=error&reason=missing_params`);
    }

    let userId: string;
    try {
      const payload = app.jwt.verify<{ sub: string }>(state);
      userId = payload.sub;
    } catch {
      return reply.redirect(`${appScheme}://shopee-connected?status=error&reason=invalid_state`);
    }

    const shopId = Number(shopIdRaw);

    try {
      const token = await exchangeCodeForToken(code, shopId);
      const info = await getShopInfo(token.access_token, shopId);

      const shop = await prisma.shop.upsert({
        where: { shopeeShopId: String(shopId) },
        update: { userId, status: 'active', shopName: info.shop_name, region: info.region },
        create: {
          shopeeShopId: String(shopId),
          shopName: info.shop_name,
          region: info.region,
          userId,
        },
      });

      const now = Date.now();
      await prisma.shopeeOAuthToken.upsert({
        where: { shopId: shop.id },
        update: {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          accessTokenExpiresAt: new Date(now + token.expire_in * 1000),
          refreshTokenExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        },
        create: {
          shopId: shop.id,
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          accessTokenExpiresAt: new Date(now + token.expire_in * 1000),
          refreshTokenExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        },
      });

      return reply.redirect(`${appScheme}://shopee-connected?status=success`);
    } catch (err) {
      app.log.error(err);
      return reply.redirect(`${appScheme}://shopee-connected?status=error&reason=exchange_failed`);
    }
  });

  app.get('/shopee/shops', { onRequest: [app.authenticate] }, async (request) => {
    const shops = await prisma.shop.findMany({
      where: { userId: request.user.sub },
      select: { id: true, shopName: true, status: true, connectedAt: true },
    });
    return { shops };
  });
}
