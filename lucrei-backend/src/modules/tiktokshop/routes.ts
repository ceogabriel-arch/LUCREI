import type { FastifyInstance } from 'fastify';

import { encrypt } from '../../lib/crypto';
import { sendShopReconnectAttemptEmail } from '../../lib/email';
import { prisma } from '../../lib/prisma';
import { exchangeCodeForToken, getAuthorizationUrl, getAuthorizedShops, toExpiryDate } from '../../tiktokshop-client';
import { runShopSync } from '../sync/tiktokshop-service';

type AuthorizeUrlQuery = {
  returnUrl?: string;
};

// Nomes dos parâmetros de volta não confirmados contra uma autorização real:
// a documentação fala em "code" + "state", mas bibliotecas de terceiros usam
// "auth_code" e o fluxo antigo manda "tts_state" - aceita os três.
type CallbackQuery = {
  code?: string;
  auth_code?: string;
  state?: string;
  tts_state?: string;
  error?: string;
};

const DEFAULT_RETURN_URL = `${process.env.APP_SCHEME || 'lucreimobile'}://tiktokshop-connected`;

// Espelha mercadolivreRoutes (modules/mercadolivre/routes.ts) - mesmo padrão
// de state JWT, proteção "shop_taken" e consumo de trial. Sem rota de webhook
// por enquanto: o recebimento de pedido é pelo sync periódico (watchdog), igual
// o Mercado Livre antes de ter webhook.
export async function tiktokshopRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AuthorizeUrlQuery }>(
    '/tiktokshop/authorize-url',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { id: request.user.sub }, include: { plan: true } });
      const integrationsLimit = user?.plan?.integrationsLimit ?? null;

      if (integrationsLimit != null) {
        // Contado POR marketplace, não no total - mesmo critério de
        // shopee/mercadolivre (ver comentário equivalente nas duas rotas).
        const activeShops = await prisma.shop.count({
          where: { userId: request.user.sub, status: 'active', provider: 'tiktok_shop' },
        });
        if (activeShops >= integrationsLimit) {
          return reply.status(403).send({
            message:
              `Seu plano ${user?.plan?.name ?? ''} permite conectar até ${integrationsLimit} loja${integrationsLimit === 1 ? '' : 's'} TikTok Shop. ` +
              'Faça upgrade pra um plano com mais integrações pra conectar outra loja TikTok Shop.',
            code: 'integrations_limit_reached',
          });
        }
      }

      const returnUrl = request.query.returnUrl || DEFAULT_RETURN_URL;
      const state = app.jwt.sign({ sub: request.user.sub, returnUrl }, { expiresIn: '30m' });
      const url = getAuthorizationUrl(state);
      return { url };
    }
  );

  app.get<{ Querystring: CallbackQuery }>('/tiktokshop/callback', async (request, reply) => {
    const code = request.query.code || request.query.auth_code;
    const state = request.query.state || request.query.tts_state;

    if (!code || !state) {
      const reason = request.query.error ? 'denied' : 'missing_params';
      return reply.redirect(`${DEFAULT_RETURN_URL}?status=error&reason=${reason}`);
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

    try {
      const token = await exchangeCodeForToken(code);
      const shops = await getAuthorizedShops(token.access_token);
      // Uma autorização pode cobrir lojas de vários países - o Lucrei só
      // trabalha com o Brasil, então prefere a loja BR e cai pra primeira só
      // se nenhuma vier marcada assim.
      const authorizedShop = shops.find((s) => s.region?.toUpperCase() === 'BR') ?? shops[0];
      if (!authorizedShop) {
        return reply.redirect(`${returnUrl}?status=error&reason=no_shop`);
      }
      const tiktokShopId = String(authorizedShop.id);

      // Mesma proteção que Shopee/ML já têm: sem isso, reconectar a mesma
      // loja noutra conta Lucrei assumiria o dono automaticamente (upsert por
      // tiktokShopId) e levaria junto o histórico já sincronizado.
      const existingShop = await prisma.shop.findUnique({ where: { tiktokShopId } });
      if (existingShop && existingShop.status === 'active' && existingShop.userId !== userId) {
        const currentOwner = await prisma.user.findUnique({ where: { id: existingShop.userId } });
        if (currentOwner) {
          await sendShopReconnectAttemptEmail(app, currentOwner.email, existingShop.shopName, 'TikTok Shop');
        }
        return reply.redirect(`${returnUrl}?status=error&reason=shop_taken`);
      }

      const shopName = authorizedShop.name || token.seller_name || 'Loja TikTok Shop';
      const shop = await prisma.shop.upsert({
        where: { tiktokShopId },
        update: { userId, status: 'active', disconnectedAt: null, shopName },
        create: {
          tiktokShopId,
          provider: 'tiktok_shop',
          shopName,
          userId,
        },
      });

      // Mesmo raciocínio anti-abuso de teste grátis que Shopee/ML já têm -
      // "1 teste por loja, pra sempre", independente de marketplace (ver
      // comentário equivalente em mercadolivre/routes.ts).
      const trialConsumedByAnotherAccount = Boolean(existingShop?.trialConsumedAt) && existingShop?.userId !== userId;

      if (!existingShop?.trialConsumedAt) {
        const owner = await prisma.user.findUnique({ where: { id: userId } });
        if (owner?.subscriptionStatus === 'trialing' && owner.trialEndsAt && owner.trialEndsAt > new Date()) {
          await prisma.shop.update({ where: { id: shop.id }, data: { trialConsumedAt: new Date() } });
        }
      } else if (trialConsumedByAnotherAccount) {
        const owner = await prisma.user.findUnique({ where: { id: userId } });
        if (owner?.subscriptionStatus === 'trialing' && owner.trialEndsAt && owner.trialEndsAt > new Date()) {
          await prisma.user.update({
            where: { id: userId },
            data: { subscriptionStatus: 'past_due', trialEndsAt: new Date() },
          });
          await prisma.subscription.updateMany({
            where: { userId, status: 'trialing' },
            data: { status: 'past_due' },
          });
        }
      }

      const tokenData = {
        shopCipher: authorizedShop.cipher,
        accessToken: encrypt(token.access_token),
        refreshToken: encrypt(token.refresh_token),
        accessTokenExpiresAt: toExpiryDate(token.access_token_expire_in, 7 * 24 * 60 * 60),
        refreshTokenExpiresAt: token.refresh_token_expire_in ? toExpiryDate(token.refresh_token_expire_in, 0) : null,
      };
      await prisma.tiktokShopOAuthToken.upsert({
        where: { shopId: shop.id },
        update: tokenData,
        create: { shopId: shop.id, ...tokenData },
      });

      // Mesmo motivo de Shopee/ML: dispara a primeira sincronização sozinho,
      // sem esperar o usuário achar o botão manual.
      runShopSync(shop.id).catch((err) => app.log.error(err));

      return reply.redirect(`${returnUrl}?status=success`);
    } catch (err) {
      app.log.error(err);
      return reply.redirect(`${returnUrl}?status=error&reason=exchange_failed`);
    }
  });
}
