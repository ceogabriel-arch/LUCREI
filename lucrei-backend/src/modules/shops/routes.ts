import crypto from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { encrypt } from '../../lib/crypto';
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

type PushBody = {
  code?: number;
  shop_id?: number;
};

type RequestWithRawBody = FastifyRequest & { rawBody?: string };

const DEFAULT_RETURN_URL = `${process.env.APP_SCHEME || 'lucreimobile'}://shopee-connected`;

// Code 3 = "Shop Authorization" — a Shopee dispara isso tanto quando o
// lojista desconecta o app pelo painel deles quanto (mais raramente) numa
// reautorização. Na prática, é o sinal que usamos pra marcar a loja como
// desconectada quando a ação não veio do nosso próprio app.
const SHOP_AUTHORIZATION_PUSH_CODE = 3;

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
          accessToken: encrypt(token.access_token),
          refreshToken: encrypt(token.refresh_token),
          accessTokenExpiresAt: new Date(now + token.expire_in * 1000),
          refreshTokenExpiresAt: new Date(now + 30 * 24 * 60 * 60 * 1000),
        },
        create: {
          shopId: shop.id,
          accessToken: encrypt(token.access_token),
          refreshToken: encrypt(token.refresh_token),
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

  // Captura o corpo bruto (só neste plugin, não afeta o resto do app) — a
  // assinatura do push da Shopee é calculada sobre a string exata do body.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as RequestWithRawBody).rawBody = body as string;
    try {
      done(null, (body as string).length > 0 ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.post<{ Body: PushBody }>('/shopee/push', async (request, reply) => {
    const partnerKey = process.env.SHOPEE_PARTNER_KEY;
    const pushUrl = `${process.env.PUBLIC_APP_URL || ''}/shopee/push`;
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';

    if (partnerKey) {
      const expected = crypto.createHmac('sha256', partnerKey).update(`${pushUrl}|${rawBody}`).digest('hex');
      if (request.headers.authorization !== expected) {
        app.log.warn('Assinatura inválida no push da Shopee.');
        return reply.status(401).send({ message: 'Assinatura inválida.' });
      }
    }

    const { code, shop_id: shopeeShopId } = request.body;

    if (code === SHOP_AUTHORIZATION_PUSH_CODE && shopeeShopId) {
      const shop = await prisma.shop.findUnique({ where: { shopeeShopId: String(shopeeShopId) } });
      if (shop) {
        await prisma.shopeeOAuthToken.deleteMany({ where: { shopId: shop.id } });
        await prisma.shop.update({
          where: { id: shop.id },
          data: { status: 'disconnected', disconnectedAt: new Date() },
        });
      }
    }

    return reply.send({});
  });
}
