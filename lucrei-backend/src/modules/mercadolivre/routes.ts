import type { FastifyInstance } from 'fastify';

import { encrypt } from '../../lib/crypto';
import { sendShopReconnectAttemptEmail } from '../../lib/email';
import { getValidAccessToken as getValidMercadoLivreAccessToken } from '../../lib/mercadolivre-token';
import { prisma } from '../../lib/prisma';
import { trackRecentMercadoLivreOrderEvent } from '../../lib/recent-order-events';
import { exchangeCodeForToken, getAuthorizationUrl, getOrder, getUser } from '../../mercadolivre-client';
import { runShopSync, syncOneMercadoLivreOrder } from '../sync/mercadolivre-service';

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

type WebhookBody = {
  resource?: string;
  topic?: string;
  user_id?: number | string;
  application_id?: number | string;
  attempts?: number;
  sent?: string;
  received?: string;
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
        // Contado POR marketplace, não no total - ver comentário equivalente
        // em shops/routes.ts (/shopee/authorize-url).
        const activeShops = await prisma.shop.count({
          where: { userId: request.user.sub, status: 'active', provider: 'mercado_livre' },
        });
        if (activeShops >= integrationsLimit) {
          return reply.status(403).send({
            message:
              `Seu plano ${user?.plan?.name ?? ''} permite conectar até ${integrationsLimit} loja${integrationsLimit === 1 ? '' : 's'} Mercado Livre. ` +
              'Faça upgrade pra um plano com mais integrações pra conectar outra loja Mercado Livre.',
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
      // "1 teste por loja, pra sempre", independente de marketplace. Usa
      // "existingShop" (estado ANTES do upsert) pra comparar o dono de
      // verdade - só é abuso quando quem consumiu o teste nessa loja antes
      // foi uma conta DIFERENTE (ver comentário equivalente em
      // shops/routes.ts, mesmo bug ao vivo corrigido nos dois ao mesmo tempo).
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

      // Mesmo motivo da Shopee: dispara a primeira sincronização sozinho,
      // sem esperar o usuário achar o botão manual.
      runShopSync(shop.id).catch((err) => app.log.error(err));

      return reply.redirect(`${returnUrl}?status=success`);
    } catch (err) {
      app.log.error(err);
      return reply.redirect(`${returnUrl}?status=error&reason=exchange_failed`);
    }
  });

  app.post<{ Body: WebhookBody }>('/mercadolivre/webhook', async (request, reply) => {
    const { resource, topic, user_id: userId } = request.body ?? {};

    // A ML exige resposta rápida (reenvia se não confirmar) e manda só um
    // ponteiro, não dado - então dispara o processamento de verdade sem
    // esperar por ele, e responde 200 na hora. Qualquer notificação de
    // topic que não seja orders_v2 (items, questions, etc.) é ignorada por
    // enquanto - só pedido interessa pra Fase 2.
    if (topic === 'orders_v2' && resource && userId) {
      const match = /^\/orders\/(\d+)/.exec(resource);
      if (match) {
        handleOrderNotification(String(userId), Number(match[1])).catch((err) => app.log.error(err));
      }
    }

    return reply.send({ received: true });
  });

  // Nunca confia no CONTEÚDO da notificação (não é assinada - não achamos
  // confirmação de um esquema tipo HMAC pra esse produto específico da ML,
  // diferente da Mercado Pago - ver nota no plano) - só usa pra saber qual
  // pedido buscar. A autorização de verdade acontece aqui: só processa se o
  // user_id bater com uma loja NOSSA de verdade, e a busca do pedido sempre
  // usa o token dessa loja (nunca confia em dado vindo de fora).
  async function handleOrderNotification(mercadoLivreShopId: string, orderId: number) {
    const shop = await prisma.shop.findFirst({
      where: { mercadoLivreShopId, provider: 'mercado_livre', status: 'active' },
    });
    if (!shop) return;

    const { accessToken } = await getValidMercadoLivreAccessToken(shop.id);
    const order = await getOrder(accessToken, orderId);

    // Alimenta a previsão de lucro na hora, pra QUALQUER status - mesmo
    // papel do push da Shopee, só que vindo de notificação real agora, não
    // só do sync periódico.
    await trackRecentMercadoLivreOrderEvent(shop.id, String(orderId), order.status ?? 'unknown');

    if (order.status === 'paid') {
      await syncOneMercadoLivreOrder(shop.id, orderId);
    }
  }
}
