import type { FastifyInstance } from 'fastify';

import { encrypt } from '../../lib/crypto';
import { sendShopReconnectAttemptEmail } from '../../lib/email';
import { prisma } from '../../lib/prisma';
import { exchangeCodeForToken, getAuthorizationUrl, getUser } from '../../mercadolivre-client';

type AuthorizeUrlQuery = {
  returnUrl?: string;
};

type CallbackQuery = {
  code?: string;
  state?: string;
  // OAuth2 padrão: ausência de "code" com "error" presente é o usuário
  // recusando a autorização na tela do Mercado Livre, não uma falha nossa.
  error?: string;
};

const DEFAULT_RETURN_URL = `${process.env.APP_SCHEME || 'lucreimobile'}://mercadolivre-connected`;

// Espelha shopRoutes (shops/routes.ts) - mesmo padrão de state JWT, proteção
// "shop_taken" e consumo de trial, adaptado pro OAuth2 padrão do Mercado
// Livre (Bearer token, sem assinatura HMAC, sem shop_id na query de volta -
// só code/state).
export async function mercadolivreRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AuthorizeUrlQuery }>(
    '/mercadolivre/authorize-url',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { id: request.user.sub }, include: { plan: true } });
      const integrationsLimit = user?.plan?.integrationsLimit ?? null;

      if (integrationsLimit != null) {
        const activeShops = await prisma.shop.count({ where: { userId: request.user.sub, status: 'active' } });
        if (activeShops >= integrationsLimit) {
          return reply.status(403).send({
            message:
              `Seu plano ${user?.plan?.name ?? ''} permite conectar até ${integrationsLimit} loja${integrationsLimit === 1 ? '' : 's'}. ` +
              'Faça upgrade pra um plano com mais integrações pra conectar outra loja.',
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

  app.get<{ Querystring: CallbackQuery }>('/mercadolivre/callback', async (request, reply) => {
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
      const info = await getUser(token.access_token);
      const mercadoLivreShopId = String(info.id);

      // Mesma proteção que a Shopee tem: sem isso, reconectar a mesma loja
      // ML noutra conta Lucrei assumiria o dono automaticamente (upsert por
      // mercadoLivreShopId) e levaria junto o histórico já sincronizado.
      const existingShop = await prisma.shop.findUnique({ where: { mercadoLivreShopId } });
      if (existingShop && existingShop.status === 'active' && existingShop.userId !== userId) {
        const currentOwner = await prisma.user.findUnique({ where: { id: existingShop.userId } });
        if (currentOwner) {
          await sendShopReconnectAttemptEmail(app, currentOwner.email, existingShop.shopName, 'Mercado Livre');
        }
        return reply.redirect(`${returnUrl}?status=error&reason=shop_taken`);
      }

      const shop = await prisma.shop.upsert({
        where: { mercadoLivreShopId },
        update: { userId, status: 'active', disconnectedAt: null, shopName: info.nickname },
        create: {
          mercadoLivreShopId,
          provider: 'mercado_livre',
          shopName: info.nickname,
          userId,
        },
      });

      // Mesmo raciocínio anti-abuso de teste grátis que a Shopee já tem -
      // "1 teste por loja, pra sempre", independente de marketplace.
      if (!shop.trialConsumedAt) {
        const owner = await prisma.user.findUnique({ where: { id: userId } });
        if (owner?.subscriptionStatus === 'trialing' && owner.trialEndsAt && owner.trialEndsAt > new Date()) {
          await prisma.shop.update({ where: { id: shop.id }, data: { trialConsumedAt: new Date() } });
        }
      } else {
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

      await prisma.mercadoLivreOAuthToken.upsert({
        where: { shopId: shop.id },
        update: {
          accessToken: encrypt(token.access_token),
          refreshToken: encrypt(token.refresh_token),
          accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
        },
        create: {
          shopId: shop.id,
          accessToken: encrypt(token.access_token),
          refreshToken: encrypt(token.refresh_token),
          accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
        },
      });

      return reply.redirect(`${returnUrl}?status=success`);
    } catch (err) {
      app.log.error(err);
      return reply.redirect(`${returnUrl}?status=error&reason=exchange_failed`);
    }
  });

  // Handler do webhook de notificações do Mercado Livre (topics: orders_v2,
  // shipments, payments, post_purchase/claims - já cadastrados no app) fica
  // pra quando a sincronização de pedido for construída (Fase 2). Até lá,
  // qualquer notificação que a ML mandar pra essa URL recebe 404 - sem
  // problema, nenhum pedido real passa por essa loja ainda.
}
