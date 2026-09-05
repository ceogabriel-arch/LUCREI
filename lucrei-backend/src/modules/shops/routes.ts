import crypto from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { encrypt } from '../../lib/crypto';
import { formatBRL, sendPushNotification } from '../../lib/push-notifications';
import { prisma } from '../../lib/prisma';
import { exchangeCodeForToken, getAuthorizationUrl, getShopInfo } from '../../shopee-client';
import { syncOneOrder } from '../sync/service';

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
  data?: {
    ordersn?: string;
    order_sn?: string;
    status?: string;
    order_status?: string;
  };
};

type RequestWithRawBody = FastifyRequest & { rawBody?: string };

const DEFAULT_RETURN_URL = `${process.env.APP_SCHEME || 'lucreimobile'}://shopee-connected`;

// Code 2 = "shop_authorization_canceled_push" — disparado quando o lojista
// desconecta o app pelo painel da própria Shopee (não pelo nosso app).
const SHOP_AUTHORIZATION_CANCELED_PUSH_CODE = 2;

// Code 3 = "order status push", segundo a documentação da Shopee Open
// Platform. Não temos como testar contra um push real antes do primeiro
// pedido de verdade — se as notificações não chegarem, o primeiro passo é
// conferir o "code" que realmente vem no log de pushes não reconhecidos
// abaixo e ajustar essa constante.
const ORDER_STATUS_PUSH_CODE = 3;
const ORDER_COMPLETED_STATUS = 'COMPLETED';

async function notifyOrderProfit(shopDbId: string, orderSn: string, orderStatus: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopDbId } });
  if (!shop) return;

  const owner = await prisma.user.findUnique({ where: { id: shop.userId } });
  if (!owner?.pushToken) return;

  const { totalProfit } = await syncOneOrder(shopDbId, orderSn, orderStatus);

  const title = 'Novo pedido concluído! 🎉';
  const body =
    totalProfit !== null
      ? `Você lucrou ${formatBRL(totalProfit)} nesse pedido.`
      : 'Cadastre o custo do produto pra ver o lucro desse pedido.';

  await sendPushNotification(owner.pushToken, title, body, { orderSn });
}

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

      // Se a conta já está no meio de um teste grátis e essa loja ainda não
      // tinha consumido teste em nenhuma outra conta, marca ela como "gasta"
      // agora - impede reconectar essa mesma loja em outra conta pra ganhar
      // um segundo teste, mesmo quando a loja é conectada depois de escolher o plano.
      if (!shop.trialConsumedAt) {
        const owner = await prisma.user.findUnique({ where: { id: userId } });
        if (owner?.subscriptionStatus === 'trialing' && owner.trialEndsAt && owner.trialEndsAt > new Date()) {
          await prisma.shop.update({ where: { id: shop.id }, data: { trialConsumedAt: new Date() } });
        }
      }

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
  // Precisa registrar "application/json" explicitamente além do "*": o
  // Fastify já tem um parser padrão pra esse tipo específico, que tem
  // prioridade sobre um catch-all e não preenche o rawBody.
  const captureRawBody = (req: RequestWithRawBody, body: unknown, done: (err: Error | null, body?: unknown) => void) => {
    const text = body as string;
    req.rawBody = text;
    try {
      done(null, text.length > 0 ? JSON.parse(text) : {});
    } catch {
      done(null, {});
    }
  };
  app.addContentTypeParser('application/json', { parseAs: 'string' }, captureRawBody);
  app.addContentTypeParser('*', { parseAs: 'string' }, captureRawBody);

  app.post<{ Body: PushBody }>('/shopee/push', async (request, reply) => {
    const partnerKey = process.env.SHOPEE_LIVE_PUSH_PARTNER_KEY;
    if (!partnerKey) {
      app.log.error('SHOPEE_LIVE_PUSH_PARTNER_KEY não configurada — recusando push da Shopee.');
      return reply.status(500).send({ message: 'Servidor não configurado para validar pushes.' });
    }

    const pushUrl = `${process.env.PUBLIC_APP_URL || ''}/shopee/push`;
    const rawBody = (request as RequestWithRawBody).rawBody ?? '';
    const expected = crypto.createHmac('sha256', partnerKey).update(`${pushUrl}|${rawBody}`).digest('hex');
    const provided = request.headers.authorization ?? '';
    const signatureValid =
      expected.length === provided.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));

    if (!signatureValid) {
      app.log.warn('Assinatura inválida no push da Shopee.');
      return reply.status(401).send({ message: 'Assinatura inválida.' });
    }

    const { code, shop_id: shopeeShopId, data } = request.body;

    if (code === SHOP_AUTHORIZATION_CANCELED_PUSH_CODE && shopeeShopId) {
      const shop = await prisma.shop.findUnique({ where: { shopeeShopId: String(shopeeShopId) } });
      if (shop) {
        await prisma.shopeeOAuthToken.deleteMany({ where: { shopId: shop.id } });
        await prisma.shop.update({
          where: { id: shop.id },
          data: { status: 'disconnected', disconnectedAt: new Date() },
        });
      }
    } else if (code === ORDER_STATUS_PUSH_CODE && shopeeShopId) {
      const orderSn = data?.ordersn ?? data?.order_sn;
      const status = data?.status ?? data?.order_status;

      if (orderSn && status === ORDER_COMPLETED_STATUS) {
        const shop = await prisma.shop.findUnique({ where: { shopeeShopId: String(shopeeShopId) } });
        if (shop) {
          // Não deixa a Shopee esperando o pedido inteiro ser processado e a
          // notificação ser enviada — responde 200 e termina em segundo plano.
          notifyOrderProfit(shop.id, orderSn, status).catch((err) => app.log.error(err));
        }
      }
    } else if (code !== undefined && code !== SHOP_AUTHORIZATION_CANCELED_PUSH_CODE) {
      app.log.info({ pushCode: code, pushBody: request.body }, 'Push da Shopee com code não tratado.');
    }

    return reply.send({});
  });
}
