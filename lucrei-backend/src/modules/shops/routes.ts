import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { exchangeCodeForToken, getAuthorizationUrl, getShopInfo } from '../../shopee-client';

type AuthorizeUrlQuery = {
  returnUrl?: string;
};

type CallbackQuery = {
  code?: string;
  shop_id?: string;
  state?: string;
};

const DEFAULT_RETURN_URL = `${process.env.APP_SCHEME || 'lucreimobile'}://shopee-connected`;

export async function shopRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AuthorizeUrlQuery }>(
    '/shopee/authorize-url',
    { onRequest: [app.authenticate] },
    async (request) => {
      const returnUrl = request.query.returnUrl || DEFAULT_RETURN_URL;
      const state = app.jwt.sign({ sub: request.user.sub, returnUrl }, { expiresIn: '15m' });
      const url = getAuthorizationUrl(state);
      return { url };
    }
  );

  app.get<{ Querystring: CallbackQuery }>('/shopee/callback', async (request, reply) => {
    const { code, shop_id: shopIdRaw, state } = request.query;

    if (!code || !shopIdRaw || !state) {
      return reply.redirect(`${DEFAULT_RETURN_URL}?status=error&reason=missing_params`);
    }

    let userId: string;
    let returnUrl: string;
    try {
      const payload = app.jwt.verify<{ sub: string; returnUrl: string }>(state);
      userId = payload.sub;
      returnUrl = payload.returnUrl || DEFAULT_RETURN_URL;
    } catch {
      return reply.redirect(`${DEFAULT_RETURN_URL}?status=error&reason=invalid_state`);
    }

    const shopId = Number(shopIdRaw);

    try {
      const token = await exchangeCodeForToken(code, shopId);
      const info = await getShopInfo(token.access_token, shopId);

      const shop = await prisma.shop.upsert({
        where: { shopeeShopId: String(shopId) },
        update: { userId, status: 'active', disconnectedAt: null, shopName: info.shop_name, region: info.region },
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

      return reply.redirect(`${returnUrl}?status=success`);
    } catch (err) {
      app.log.error(err);
      return reply.redirect(`${returnUrl}?status=error&reason=exchange_failed`);
    }
  });

  app.get('/shopee/shops', { onRequest: [app.authenticate] }, async (request) => {
    const shops = await prisma.shop.findMany({
      where: { userId: request.user.sub },
      select: { id: true, shopName: true, status: true, connectedAt: true, disconnectedAt: true },
    });
    return { shops };
  });

  app.post<{ Params: { shopId: string } }>(
    '/shops/:shopId/disconnect',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      await prisma.shopeeOAuthToken.deleteMany({ where: { shopId: shop.id } });
      const updated = await prisma.shop.update({
        where: { id: shop.id },
        data: { status: 'disconnected', disconnectedAt: new Date() },
      });

      return { id: updated.id, status: updated.status, disconnectedAt: updated.disconnectedAt };
    }
  );
}
