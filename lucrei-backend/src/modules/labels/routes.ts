import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../lib/prisma';
import { getValidAccessToken } from '../../lib/shopee-token';
import { getOrderDetail } from '../../shopee-client';
import { extractOrderSnsByPage, resizePdfToLabel } from './service';

// Monta "2x Ração Golden 10kg + 1x Areia Sanitária" a partir dos itens do
// pedido.
function formatOrderProductLabel(lineItems: Array<{ quantity: number; name: string }>): string | null {
  if (lineItems.length === 0) return null;
  const counted = new Map<string, number>();
  for (const li of lineItems) {
    counted.set(li.name, (counted.get(li.name) ?? 0) + li.quantity);
  }
  return [...counted.entries()].map(([name, qty]) => `${qty}x ${name}`).join(' + ');
}

// Etiqueta de envio é impressa logo depois da venda, muito antes do pedido
// chegar em "concluído" - e o Lucrei só sincroniza pedido COMPLETED (só aí
// os valores de repasse da Shopee ficam definitivos pra calcular lucro). Ou
// seja, na prática o pedido quase nunca está no banco ainda quando a
// etiqueta é gerada. Por isso: primeiro tenta achar no que já está
// sincronizado (rápido, não gasta chamada da API), e pro resto busca ao vivo
// na Shopee via get_order_detail, que devolve os itens do pedido em
// QUALQUER status - diferente do get_escrow_detail usado na sincronização.
async function lookupProductLabels(userId: string, orderSns: string[]): Promise<Map<string, string>> {
  const labelBySn = new Map<string, string>();
  if (orderSns.length === 0) return labelBySn;

  const synced = await prisma.order.findMany({
    where: { shopeeOrderSn: { in: orderSns }, shop: { userId } },
    include: { lineItems: { include: { product: { select: { name: true } } } } },
  });
  for (const order of synced) {
    const items = order.lineItems
      .map((li) => ({ quantity: li.quantity, name: li.product?.name ?? li.itemName }))
      .filter((li): li is { quantity: number; name: string } => !!li.name);
    const label = formatOrderProductLabel(items);
    if (label) labelBySn.set(order.shopeeOrderSn, label);
  }

  const remaining = orderSns.filter((sn) => !labelBySn.has(sn));
  if (remaining.length === 0) return labelBySn;

  const shops = await prisma.shop.findMany({ where: { userId, status: 'active' } });
  for (const shop of shops) {
    const stillRemaining = orderSns.filter((sn) => !labelBySn.has(sn));
    if (stillRemaining.length === 0) break;

    try {
      const { accessToken, shopeeShopId } = await getValidAccessToken(shop.id);
      const orderList = await getOrderDetail(accessToken, shopeeShopId, stillRemaining, ['item_list']);
      for (const order of orderList) {
        const items = (order.item_list ?? [])
          .map((it) => ({ quantity: it.model_quantity_purchased ?? it.quantity_purchased ?? 1, name: it.item_name }))
          .filter((it): it is { quantity: number; name: string } => !!it.name);
        const label = formatOrderProductLabel(items);
        if (label) labelBySn.set(order.order_sn, label);
      }
    } catch {
      // Uma loja falhando (token expirado, pedido de outra loja etc.) não
      // pode impedir de tentar as outras lojas do usuário.
    }
  }

  return labelBySn;
}

export const labelRoutes: FastifyPluginAsync = async (app) => {
  app.post('/labels/resize', { onRequest: [app.authenticate] }, async (request, reply) => {
    const file = await request.file();
    if (!file) {
      return reply.status(400).send({ message: 'Envie um arquivo PDF.' });
    }
    if (file.mimetype !== 'application/pdf') {
      return reply.status(400).send({ message: 'O arquivo precisa ser um PDF.' });
    }

    const bytes = await file.toBuffer();

    // Só funciona pra etiquetas da Shopee (único marketplace integrado) -
    // pra etiqueta de outro marketplace, isso simplesmente não acha nenhum
    // pedido e segue sem escrever nada.
    let productLabelByPage: Array<string | null> | undefined;
    try {
      const orderSnsByPage = await extractOrderSnsByPage(bytes);
      const orderSns = [...new Set(orderSnsByPage.filter((sn): sn is string => !!sn))];

      if (orderSns.length > 0) {
        const labelBySn = await lookupProductLabels(request.user.sub, orderSns);
        productLabelByPage = orderSnsByPage.map((sn) => (sn ? (labelBySn.get(sn) ?? null) : null));
      }
    } catch (err) {
      // Identificar o produto é um extra - se der errado, segue sem ele em
      // vez de derrubar o redimensionamento inteiro.
      app.log.warn(err, 'Falha ao identificar produto da etiqueta');
    }

    let resized: Uint8Array;
    try {
      resized = await resizePdfToLabel(bytes, { productLabelByPage });
    } catch {
      return reply.status(400).send({ message: 'Não foi possível ler esse PDF. Confira se o arquivo não está corrompido.' });
    }

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', 'attachment; filename="etiquetas-100x150.pdf"');
    return reply.send(Buffer.from(resized));
  });
};
