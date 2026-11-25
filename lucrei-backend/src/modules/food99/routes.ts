import type { FastifyInstance } from 'fastify';

import { encrypt } from '../../lib/crypto';
import { sendShopReconnectAttemptEmail } from '../../lib/email';
import {
  bindShop,
  getAuthorizationUrl,
  listAuthorizedShops,
  parseBigSafe,
  verifyWebhookSignature,
} from '../../food99-client';
import { prisma } from '../../lib/prisma';
import { handleOrderCancel, handleOrderNew } from '../sync/food99-service';

type ConnectBody = { food99ShopId?: string; shopName?: string };

// Espelha ifoodRoutes/tiktokshopRoutes - mesmo limite de plano por
// marketplace, mesma proteção "shop_taken" e consumo de trial. Diferente das
// outras: não há redirecionamento OAuth nem código de vínculo - a 99Food usa
// um fluxo de 2 passos (autorizar no site deles, depois escolher a loja
// aqui), por isso /authorize-url, /discover e /connect são 3 rotas
// separadas em vez de authorize-url + callback.
export async function food99Routes(app: FastifyInstance) {
  // Passo 1: URL genérica (vale 7 dias, não carrega identificação de usuário -
  // a 99Food não suporta isso) que o lojista abre, loga e autoriza a loja.
  app.get('/food99/authorize-url', { onRequest: [app.authenticate] }, async (_request, reply) => {
    try {
      const url = await getAuthorizationUrl();
      return { url };
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({ message: 'A 99Food não respondeu a tempo. Tente de novo em instantes.' });
    }
  });

  // Passo 2: depois que o lojista autoriza no site da 99Food, ele volta pro
  // Lucrei e essa rota lista as lojas autorizadas que ainda não foram
  // vinculadas a nenhum app_shop_id - pra ele escolher a dele pelo nome
  // (mesmo processo descrito em "Get Authorization Web Page" > Self-Service
  // Binding). Pode vir vazio por alguns segundos até a 99Food processar a
  // autorização.
  app.get('/food99/discover', { onRequest: [app.authenticate] }, async (_request, reply) => {
    try {
      const unbound: { shopId: string; shopName: string }[] = [];
      let pageNo = 1;
      while (true) {
        const { shops, totalPages } = await listAuthorizedShops(pageNo, 50);
        for (const s of shops) {
          if (s.bound_flag === 0) unbound.push({ shopId: s.shop_id, shopName: s.shop_name });
        }
        if (pageNo >= totalPages || pageNo > 10) break;
        pageNo++;
      }
      return { shops: unbound };
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({
        message: 'Não consegui listar as lojas autorizadas na 99Food. Esse recurso pode exigir liberação especial da 99Food.',
      });
    }
  });

  // Passo 3: vincula de verdade (shop_id da 99Food + app_shop_id escolhido
  // pelo Lucrei = o próprio Shop.id). ATENÇÃO: segundo a documentação,
  // "Bind Store" só funciona em Ambiente de Produção - pode falhar aqui
  // enquanto o app da 99Food estiver em Ambiente de teste.
  app.post<{ Body: ConnectBody }>('/food99/connect', { onRequest: [app.authenticate] }, async (request, reply) => {
    const userId = request.user.sub;
    const food99ShopId = request.body?.food99ShopId;
    const shopName = request.body?.shopName?.trim() || 'Loja 99Food';
    if (!food99ShopId) return reply.status(400).send({ message: 'Escolha a loja autorizada na 99Food.' });

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { plan: true } });
    const integrationsLimit = user?.plan?.integrationsLimit ?? null;
    if (integrationsLimit != null) {
      const activeShops = await prisma.shop.count({ where: { userId, status: 'active', provider: 'food99' } });
      if (activeShops >= integrationsLimit) {
        return reply.status(403).send({
          message:
            `Seu plano ${user?.plan?.name ?? ''} permite conectar até ${integrationsLimit} loja${integrationsLimit === 1 ? '' : 's'} 99Food. ` +
            'Faça upgrade pra um plano com mais integrações pra conectar outra loja 99Food.',
          code: 'integrations_limit_reached',
        });
      }
    }

    // Mesma proteção que as outras integrações têm: sem isso, vincular a
    // mesma loja 99Food noutra conta Lucrei assumiria o dono automaticamente.
    // food99ShopId aqui é o shop_id da PRÓPRIA 99Food (o que veio do
    // /food99/discover) - não confundir com o app_shop_id que o Lucrei
    // escolhe (= Shop.id), usado nas chamadas de API.
    const existingShop = await prisma.shop.findUnique({ where: { food99ShopId } });
    if (existingShop && existingShop.status === 'active') {
      if (existingShop.userId !== userId) {
        const currentOwner = await prisma.user.findUnique({ where: { id: existingShop.userId } });
        if (currentOwner) await sendShopReconnectAttemptEmail(app, currentOwner.email, existingShop.shopName, '99Food');
        return reply.status(409).send({
          message: 'Essa loja 99Food já está conectada em outra conta Lucrei. Peça para desconectá-la lá antes de conectar aqui.',
          code: 'shop_taken',
        });
      }
      // Mesmo dono tentando conectar de novo a loja que já está ativa (ex.:
      // tocou duas vezes) - sem essa checagem, cairia no create abaixo e
      // esbarraria no @unique de food99ShopId só na hora de salvar o bind.
      return reply.status(409).send({ message: 'Essa loja 99Food já está conectada na sua conta.', code: 'already_connected' });
    }

    try {
      // Diferente das outras integrações, aqui sempre cria uma loja nova em
      // vez de upsert por food99ShopId: esse id só existe DEPOIS do bind, que
      // precisa de um app_shop_id (= Shop.id) antes de existir a loja. Efeito
      // colateral conhecido: se o lojista desconectar e tentar reconectar a
      // MESMA loja 99Food, o vínculo antigo continua "bound" do lado da
      // 99Food (não existe chamada de unbind aqui ainda - ver "Unbind Store"
      // na documentação, não lida) e o bindShop abaixo vai falhar até alguém
      // desvincular manualmente pelo Portal (Application Management > Store
      // Management > Batch Store Management > Unbind).
      const shop = await prisma.shop.create({
        data: { userId, provider: 'food99', shopName, status: 'active' },
      });

      let bound;
      try {
        bound = await bindShop(food99ShopId, shop.id);
      } catch (err) {
        await prisma.shop.delete({ where: { id: shop.id } });
        throw err;
      }

      await prisma.shop.update({ where: { id: shop.id }, data: { food99ShopId: bound.shopId } });
      await prisma.food99OAuthToken.create({
        data: { shopId: shop.id, authToken: encrypt(bound.authToken), authTokenExpiresAt: bound.authTokenExpiresAt },
      });

      // Mesmo raciocínio anti-abuso de teste grátis das outras integrações.
      if (user?.subscriptionStatus === 'trialing' && user.trialEndsAt && user.trialEndsAt > new Date()) {
        await prisma.shop.update({ where: { id: shop.id }, data: { trialConsumedAt: new Date() } });
      }

      return { status: 'success', shopId: shop.id, shopName: shop.shopName };
    } catch (err) {
      app.log.error(err);
      return reply.status(502).send({
        message: 'Falha ao vincular a loja na 99Food. Esse recurso pode exigir o app em Ambiente de Produção ou liberação especial da 99Food.',
        code: 'bind_failed',
      });
    }
  });

  // Webhook de pedido - a 99Food empurra de verdade (orderNew/orderConfirm/
  // orderReady/orderCancel/orderFinish), diferente da iFood. Registrado num
  // sub-contexto próprio (app.register aninhado) só pra isolar o
  // content-type parser customizado do resto das rotas acima - sem isso, o
  // encapsulamento do Fastify faria TODAS as rotas desse arquivo usarem o
  // parser de json-bigint, quebrando o body normal de /food99/connect.
  await app.register(async (webhookApp) => {
    // json-bigint: order_id/shop_id são inteiros de 64 bits e um JSON.parse
    // comum perde precisão neles (confirmado em toda a documentação da
    // 99Food).
    webhookApp.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
      try {
        done(null, { raw: body as string, parsed: parseBigSafe.parse(body as string) });
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    webhookApp.post<{ Body: { raw: string; parsed: Record<string, unknown> } }>('/food99/webhook', async (request, reply) => {
      const { raw, parsed } = request.body ?? { raw: '', parsed: {} };
      const headerSign = request.headers['didi-header-sign'] as string | undefined;

      if (!verifyWebhookSignature(raw, headerSign)) {
        return reply.status(401).send({ errno: 1, errmsg: 'assinatura inválida' });
      }

      const appShopId = String(parsed.app_shop_id ?? '');
      const type = String(parsed.type ?? '');
      const data = (parsed.data ?? {}) as Record<string, unknown>;

      try {
        // app_shop_id do webhook é o próprio Shop.id (ver food99-client/
        // index.ts) - food99ShopId no schema é outra coisa (o shop_id da
        // PRÓPRIA 99Food, só usado pra detectar loja duplicada em /connect).
        const shop = await prisma.shop.findFirst({ where: { id: appShopId, provider: 'food99' } });
        if (!shop) {
          // Loja desconhecida (ex.: evento de teste da Sandbox antes do
          // vínculo) - confirma recebido pra 99Food não ficar reenviando.
          return { errno: 0, errmsg: 'ok' };
        }

        if (type === 'orderNew') {
          const orderInfo = (data as { order_info?: unknown }).order_info;
          if (orderInfo) await handleOrderNew(shop.id, orderInfo as Parameters<typeof handleOrderNew>[1]);
        } else if (type === 'orderCancel' || type === 'orderPartialCancel') {
          const orderId = String((data as { order_id?: unknown }).order_id ?? '');
          if (orderId) await handleOrderCancel(shop.id, orderId);
        }
        // orderConfirm/orderReady/orderFinish: nada a fazer hoje - orderNew
        // já grava o pedido completo e a reconciliação financeira (watchdog)
        // preenche a comissão depois. Só confirma recebido.

        return { errno: 0, errmsg: 'ok' };
      } catch (err) {
        app.log.error(err);
        // errno != 0 faz a 99Food reenviar o mesmo evento depois.
        return reply.status(200).send({ errno: 1, errmsg: 'erro interno, reenviar' });
      }
    });
  });
}
