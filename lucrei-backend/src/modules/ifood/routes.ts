import type { FastifyInstance } from 'fastify';

import { decrypt, encrypt } from '../../lib/crypto';
import { sendShopReconnectAttemptEmail } from '../../lib/email';
import { exchangeAuthorizationCode, getMerchants, IfoodAuthorizationCodeError, requestUserCode } from '../../ifood-client';
import { prisma } from '../../lib/prisma';
import { runShopSync } from '../sync/ifood-service';

type ConnectBody = {
  linkToken?: string;
  authorizationCode?: string;
};

type LinkTokenPayload = { sub: string; kind: 'ifood_link'; verifier: string };

// Mesmas regras de mercadolivreRoutes (modules/mercadolivre/routes.ts) -
// limite do plano, proteção "shop_taken" e consumo de trial - mas sem
// redirecionamento: a iFood vincula por código (ver ifood-client/index.ts).
// Sem rota de webhook aqui: a iFood não empurra pedido, o recebimento é 100%
// via watchdog de polling (ver ifood-poll-watchdog.ts).
export async function ifoodRoutes(app: FastifyInstance) {
  async function integrationsLimitMessage(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { plan: true } });
    const integrationsLimit = user?.plan?.integrationsLimit ?? null;
    if (integrationsLimit == null) return null;

    // Contado POR marketplace, não no total - mesmo critério de
    // shopee/mercadolivre (ver comentário equivalente nas duas rotas).
    const activeShops = await prisma.shop.count({
      where: { userId, status: 'active', provider: 'ifood' },
    });
    if (activeShops < integrationsLimit) return null;
    return (
      `Seu plano ${user?.plan?.name ?? ''} permite conectar até ${integrationsLimit} loja${integrationsLimit === 1 ? '' : 's'} iFood. ` +
      'Faça upgrade pra um plano com mais integrações pra conectar outra loja iFood.'
    );
  }

  // Passo 1: gera o código de vínculo que o lojista digita no Portal do
  // Parceiro. O verifier volta pro app só dentro de um JWT assinado e
  // cifrado (linkToken) - assim o backend não precisa guardar estado entre
  // os dois passos e o app nunca vê o verifier em texto puro.
  // Sem checar o limite do plano aqui: ainda não dá pra saber se é loja nova
  // ou a reconexão de uma já conectada (que não pode ser barrada) - o limite
  // é conferido em /ifood/connect, depois de saber qual é a loja.
  app.post('/ifood/user-code', { onRequest: [app.authenticate] }, async (request, reply) => {
    try {
      const userCode = await requestUserCode();
      const linkToken = app.jwt.sign(
        { sub: request.user.sub, kind: 'ifood_link', verifier: encrypt(userCode.authorizationCodeVerifier) },
        // String com unidade: número puro no fast-jwt é milissegundo.
        { expiresIn: `${userCode.expiresIn}s` }
      );
      return {
        userCode: userCode.userCode,
        verificationUrl: userCode.verificationUrlComplete || userCode.verificationUrl,
        expiresIn: userCode.expiresIn,
        linkToken,
      };
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({ message: 'A iFood não respondeu a tempo. Tente de novo em instantes.' });
    }
  });

  // Passo 2: troca o código de autorização (mostrado pelo Portal do Parceiro
  // depois do lojista aprovar) pelo token e conecta a loja.
  app.post<{ Body: ConnectBody }>('/ifood/connect', { onRequest: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const authorizationCode = request.body?.authorizationCode?.trim().toUpperCase();
    const linkToken = request.body?.linkToken;

    if (!authorizationCode || !linkToken) {
      return reply.status(400).send({ message: 'Cole o código de autorização que o Portal do Parceiro mostrou.' });
    }

    let verifier: string;
    try {
      const payload = app.jwt.verify<LinkTokenPayload>(linkToken);
      if (payload.kind !== 'ifood_link' || payload.sub !== userId) throw new Error('linkToken de outro usuário');
      verifier = decrypt(payload.verifier);
    } catch {
      return reply.status(400).send({
        message: 'O código de vínculo venceu (vale 10 minutos). Feche esta janela e conecte o iFood de novo pelo "Conectar marketplace".',
        code: 'link_expired',
      });
    }

    try {
      let token;
      try {
        token = await exchangeAuthorizationCode(authorizationCode, verifier);
      } catch (err) {
        if (err instanceof IfoodAuthorizationCodeError) {
          return reply.status(400).send({
            message: 'A iFood recusou esse código de autorização. Confira se copiou certo - ele vale só 5 minutos.',
            code: 'invalid_code',
          });
        }
        throw err;
      }

      const merchants = await getMerchants(token.accessToken);
      const merchant = merchants[0];
      if (!merchant) {
        return reply.status(400).send({
          message: 'Essa autorização não liberou nenhuma loja iFood. Confira se você está logado na loja certa no Portal do Parceiro.',
          code: 'no_merchant',
        });
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
        return reply.status(409).send({
          message:
            'Essa loja iFood já está conectada em outra conta Lucrei. Peça para desconectá-la lá (em Configurações) antes de conectar aqui.',
          code: 'shop_taken',
        });
      }

      // Reconectar a própria loja ativa (ex.: depois de "autorização
      // vencida") não conta como loja nova - antes o limite contava ela
      // mesma e, no plano de 1 loja, impedia reconectar.
      const reconnectingOwnShop = existingShop?.status === 'active' && existingShop.userId === userId;
      if (!reconnectingOwnShop) {
        const limitMessage = await integrationsLimitMessage(userId);
        if (limitMessage) {
          return reply.status(403).send({ message: limitMessage, code: 'integrations_limit_reached' });
        }
      }

      const shop = await prisma.shop.upsert({
        where: { ifoodShopId },
        // syncStatus/syncError limpos: tira a loja do estado "reconecte"
        // (IFOOD_RECONNECT_MESSAGE), que fazia o watchdog pular ela.
        update: {
          userId,
          status: 'active',
          disconnectedAt: null,
          shopName: merchant.name,
          syncStatus: null,
          syncError: null,
        },
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

      const tokenData = {
        merchantId: merchant.id,
        accessToken: encrypt(token.accessToken),
        refreshToken: encrypt(token.refreshToken),
        accessTokenExpiresAt: new Date(Date.now() + token.expiresIn * 1000),
      };
      await prisma.ifoodOAuthToken.upsert({
        where: { shopId: shop.id },
        update: tokenData,
        create: { shopId: shop.id, ...tokenData },
      });

      // Mesmo motivo de Shopee/ML: dispara a primeira sincronização sozinho,
      // sem esperar o usuário achar o botão manual.
      runShopSync(shop.id).catch((err) => app.log.error(err));

      return { status: 'success', shopName: merchant.name };
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({
        message: 'Falha temporária na comunicação com a iFood. Tente conectar de novo em instantes.',
        code: 'exchange_failed',
      });
    }
  });
}
