import type { FastifyPluginAsync } from 'fastify';

import { prisma } from '../../lib/prisma';
import { extractOrderSnsByPage, resizePdfToLabel } from './service';

// Monta "2x Ração Golden 10kg + 1x Areia Sanitária" a partir dos itens do
// pedido - usa o nome do produto do catálogo, com o nome capturado na hora
// da venda como fallback (mesma lógica do CSV de pedidos, pra cobrir item
// descontinuado da Shopee que não tem mais Product vinculado).
function formatOrderProductLabel(order: {
  lineItems: Array<{ quantity: number; itemName: string | null; product: { name: string } | null }>;
}): string | null {
  const parts = order.lineItems
    .map((li) => li.product?.name ?? li.itemName)
    .filter((name): name is string => !!name);
  if (parts.length === 0) return null;

  const counted = new Map<string, number>();
  order.lineItems.forEach((li, i) => {
    const name = parts[i];
    if (!name) return;
    counted.set(name, (counted.get(name) ?? 0) + li.quantity);
  });

  return [...counted.entries()].map(([name, qty]) => `${qty}x ${name}`).join(' + ');
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

    // Só funciona pra etiquetas da Shopee (único marketplace com pedidos
    // sincronizados no banco) - pra etiquetas de outro marketplace, isso
    // simplesmente não acha nenhum pedido e segue sem escrever nada.
    let productLabelByPage: Array<string | null> | undefined;
    try {
      const orderSnsByPage = await extractOrderSnsByPage(bytes);
      const orderSns = [...new Set(orderSnsByPage.filter((sn): sn is string => !!sn))];

      if (orderSns.length > 0) {
        const orders = await prisma.order.findMany({
          where: { shopeeOrderSn: { in: orderSns }, shop: { userId: request.user.sub } },
          include: { lineItems: { include: { product: { select: { name: true } } } } },
        });
        const labelBySn = new Map(orders.map((order) => [order.shopeeOrderSn, formatOrderProductLabel(order)]));
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
