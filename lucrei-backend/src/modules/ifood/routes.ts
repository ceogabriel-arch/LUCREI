import type { FastifyInstance } from 'fastify';

import { encrypt } from '../../lib/crypto';
import { sendShopReconnectAttemptEmail } from '../../lib/email';
import { exchangeCodeForToken, getAuthorizationUrl, getMerchants } from '../../ifood-client';
import { prisma } from '../../lib/prisma';
import { runShopSync } from '../sync/ifood-service';

type AuthorizeUrlQuery = {
  returnUrl?: string;
};

type CallbackQuery = {
  code?: string;
  state?: string;
  error?: string;
};

const DEFAULT_RETURN_URL = `${process.env.APP_SCHEME || 'lucreimobile'}://ifood-connected`;

// Espelha mercadolivreRoutes (modules/mercadolivre/routes.ts) - mesmo padrão
// de state JWT, proteção "shop_taken" e consumo de trial. Sem rota de
// webhook aqui: a iFood não empurra pedido, o recebimento é 100% via
// watchdog de polling (ver ifood-poll-watchdog.ts).
export async function ifoodRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AuthorizeUrlQuery }>(
    '/ifood/authorize-url',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { id: request.user.sub }, include: { plan: true } });
      const integrationsLimit = user?.plan?.integrationsLimit ?? null;

      if (integrationsLimit != null) {
        // Contado POR marketplace, não no total - mesmo critério de
        // shopee/mercadolivre (ver comentário equivalente nas duas rotas).
        const activeShops = await prisma.shop.count({
          where: { userId: request.user.sub, status: 'active', provider: 'ifood' },
        });
        if (activeShops >= integrationsLimit) {
          return reply.status(403).send({
            message:
              `Seu plano ${user?.plan?.name ?? ''} permite conectar até ${integrationsLimit} loja${integrationsLimit === 1 ? '' : 's'} iFood. ` +
              'Faça upgrade pra um plano com mais integrações pra conectar outra loja iFood.',
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

  app.get<{ Querystring: CallbackQuery }>('/ifood/callback', async (request, reply) => {
    const { code, state, error } = request.query;

    if (!code || !state) {
      const reason = error ? 'denied' : 'missing_params';
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
      const merchants = await getMerchants(token.accessToken);
      const merchant = merchants[0];
      if (!merchant) {
        return reply.redirect(`${returnUrl}?status=error&reason=no_merchant`);
      }
      const ifoodShopId = merchant.id;

      // Mesma proteção que Shopee/ML já têm: sem isso, reconectar a mesma
      // loja iFood noutra conta Lucrei assumiria o dono automaticamente
      // (upsert por ifoodShopId) e levaria junto o histórico já sincronizado.
      const existingShop = await prisma.shop.findUnique({ where: { ifoodShopId } });
      if (existingShop && existingShop.status === 'active' && existingShop.userId !== userId) {
        const currentOwner = await prisma.user.findUnique({ where: { id: existingShop.userId } });
        if (currentOwner) {
          await sendShopReconnectAttemptEmail(app, currentOwner.email, existingShop.shopName, 'iFood');
        }
        return reply.redirect(`${returnUrl}?status=error&reason=shop_taken`);
      }

      const shop = await prisma.shop.upsert({
        where: { ifoodShopId },
        update: { userId, status: 'active', disconnectedAt: null, shopName: merchant.name },
        create: {
          ifoodShopId,
          provider: 'ifood',
          shopName: merchant.name,
          userId,
        },
      });

      // Mesmo raciocínio anti-abuso de teste grátis que Shopee/ML já têm -
      // "1 teste por loja, pra sempre", independente de marketplace.
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

      await prisma.ifoodOAuthToken.upsert({
        where: { shopId: shop.id },
        update: {
          merchantId: merchant.id,
          accessToken: encrypt(token.accessToken),
          refreshToken: encrypt(token.refreshToken),
          accessTokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
        },
        create: {
          shopId: shop.id,
          merchantId: merchant.id,
          accessToken: encrypt(token.accessToken),
          refreshToken: encrypt(token.refreshToken),
          accessTokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
        },
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
