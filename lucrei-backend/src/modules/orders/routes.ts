import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';

import { prisma } from '../../lib/prisma';
import { rangeStart, type Period } from '../../lib/period';

const STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Aguardando pagamento',
  READY_TO_SHIP: 'Pronto pra envio',
  PROCESSED: 'Em processamento',
  SHIPPED: 'Enviado',
  COMPLETED: 'Concluído',
  IN_CANCEL: 'Cancelando',
  CANCELLED: 'Cancelado',
  TO_RETURN: 'Em devolução',
};

// Excel/Sheets em PT-BR esperam vírgula decimal - ponto quebraria a leitura
// como número numa planilha com locale PT-BR.
function csvNumber(n: number) {
  return n.toFixed(2).replace('.', ',');
}

// Só precisa escapar se o campo tiver o delimitador, aspas ou quebra de
// linha - produto poderia ter ";" ou quebra de linha no nome.
function csvField(value: string) {
  if (/[;"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Mesmas colunas da planilha pros dois formatos - CSV formata número/data
// como texto (vírgula decimal, dd/mm/aaaa) pra abrir certo num locale PT-BR,
// enquanto o .xlsx guarda os valores nativos (Date/number) pra abrir já
// filtrável/somável no Excel sem precisar converter nada.
async function buildOrdersXlsx(header: string[], rows: (string | number | Date | null)[][], sheetName: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(header);
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);

  const dateColIndex = header.indexOf('Data do pedido') + 1;
  if (dateColIndex > 0) sheet.getColumn(dateColIndex).numFmt = 'dd/mm/yyyy';
  header.forEach((label, index) => {
    if (label.includes('(R$)')) sheet.getColumn(index + 1).numFmt = '#,##0.00';
  });
  sheet.columns.forEach((col) => {
    col.width = 18;
  });

  return workbook.xlsx.writeBuffer();
}

export async function orderRoutes(app: FastifyInstance) {
  app.get<{ Params: { shopId: string }; Querystring: { period?: Period } }>(
    '/shops/:shopId/orders',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const period = request.query.period ?? '30d';

      const orders = await prisma.order.findMany({
        where: { shopId: shop.id, completedAt: { gte: rangeStart(period) } },
        include: { lineItems: { include: { product: true } } },
        orderBy: { orderDate: 'desc' },
      });

      return {
        orders: orders.map((order) => {
          let revenue = 0;
          let profit = 0;
          let itemsMissingCost = 0;

          for (const li of order.lineItems) {
            revenue += Number(li.salePrice);
            if (li.profit !== null) {
              profit += Number(li.profit);
            } else {
              itemsMissingCost++;
            }
          }

          return {
            id: order.id,
            // Decisão de arquitetura da Fase 2 do Mercado Livre: o campo da
            // API continua se chamando "shopeeOrderSn" mesmo pra pedido ML
            // (carrega o mercadoLivreOrderId por baixo) - o app mobile já lê
            // esse nome em 3 lugares (pedidos.tsx) e não precisa saber a
            // diferença. Sem esse fallback, pedido ML mandava null aqui e
            // quebrava a busca por texto no app (Cannot read 'toLowerCase'
            // of null) - mesmo fallback que o /orders/export já tinha.
            shopeeOrderSn: order.shopeeOrderSn ?? order.mercadoLivreOrderId,
            orderStatus: order.orderStatus,
            orderDate: order.orderDate,
            revenue,
            profit: itemsMissingCost === order.lineItems.length ? null : profit,
            itemsMissingCost,
            lineItems: order.lineItems.map((li) => ({
              id: li.id,
              productName: li.product?.name ?? li.itemName ?? `Item ${li.shopeeItemId ?? '?'}`,
              quantity: li.quantity,
              salePrice: Number(li.salePrice),
              shippingFeeAllocated: Number(li.shippingFeeAllocated),
              shopeeFeeAllocated: Number(li.shopeeFeeAllocated),
              taxAllocated: Number(li.taxAllocated),
              productCostSnapshot: li.productCostSnapshot !== null ? Number(li.productCostSnapshot) : null,
              profit: li.profit !== null ? Number(li.profit) : null,
            })),
          };
        }),
      };
    }
  );

  app.get<{ Params: { shopId: string }; Querystring: { from: string; to: string; format?: 'csv' | 'xlsx' } }>(
    '/shops/:shopId/orders/export',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      const { from, to, format } = request.query;
      if (!from || !to) {
        return reply.status(400).send({ message: 'from e to são obrigatórios.' });
      }

      const orders = await prisma.order.findMany({
        where: { shopId: shop.id, completedAt: { gte: new Date(from), lt: new Date(to) } },
        include: { lineItems: { include: { product: true } } },
        orderBy: { orderDate: 'asc' },
      });

      const marketplaceLabel = shop.provider === 'mercado_livre' ? 'Mercado Livre' : 'Shopee';
      const header = [
        'Data do pedido',
        'Nº do pedido',
        'Status',
        'Produto',
        'Quantidade',
        'Valor de venda (R$)',
        'Frete alocado (R$)',
        `Taxa ${marketplaceLabel} (R$)`,
        'Imposto (R$)',
        'Custo do produto (R$)',
        'Lucro (R$)',
      ].join(';');

      const filenameBase = `pedidos-lucrei-${shop.shopName.replace(/[^a-zA-Z0-9]/g, '-')}`;

      if (format === 'xlsx') {
        const xlsxRows: (string | number | Date | null)[][] = [];
        for (const order of orders) {
          const statusStr = STATUS_LABELS[order.orderStatus] ?? order.orderStatus;
          for (const li of order.lineItems) {
            const productName = li.product?.name ?? li.itemName ?? `Item ${li.shopeeItemId ?? '?'}`;
            xlsxRows.push([
              order.orderDate,
              order.shopeeOrderSn ?? order.mercadoLivreOrderId ?? '',
              statusStr,
              productName,
              li.quantity,
              Number(li.salePrice),
              Number(li.shippingFeeAllocated),
              Number(li.shopeeFeeAllocated),
              Number(li.taxAllocated),
              li.productCostSnapshot !== null ? Number(li.productCostSnapshot) : null,
              li.profit !== null ? Number(li.profit) : null,
            ]);
          }
        }
        const buffer = await buildOrdersXlsx(header.split(';'), xlsxRows, 'Pedidos');
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', `attachment; filename="${filenameBase}.xlsx"`);
        return reply.send(buffer);
      }

      const rows: string[] = [header];
      for (const order of orders) {
        const dateStr = order.orderDate.toLocaleDateString('pt-BR');
        const statusStr = STATUS_LABELS[order.orderStatus] ?? order.orderStatus;
        for (const li of order.lineItems) {
          const productName = li.product?.name ?? li.itemName ?? `Item ${li.shopeeItemId ?? '?'}`;
          rows.push(
            [
              dateStr,
              // Um dos dois é sempre preenchido, dependendo do marketplace da loja.
              csvField(order.shopeeOrderSn ?? order.mercadoLivreOrderId ?? ''),
              csvField(statusStr),
              csvField(productName),
              String(li.quantity),
              csvNumber(Number(li.salePrice)),
              csvNumber(Number(li.shippingFeeAllocated)),
              csvNumber(Number(li.shopeeFeeAllocated)),
              csvNumber(Number(li.taxAllocated)),
              li.productCostSnapshot !== null ? csvNumber(Number(li.productCostSnapshot)) : '',
              li.profit !== null ? csvNumber(Number(li.profit)) : '',
            ].join(';')
          );
        }
      }

      // BOM no início - sem isso o Excel abre acento/ç como caractere quebrado
      // por assumir a codificação errada num CSV UTF-8 puro.
      const csv = '﻿' + rows.join('\r\n');

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
      return reply.send(csv);
    }
  );

  // Mesmo CSV de cima, só que somando todas as lojas ativas da conta -
  // "Todas as lojas" no seletor. Ganha uma coluna "Loja" extra (faz falta
  // aqui, já que mistura pedido de lojas/marketplaces diferentes) e o
  // rótulo da taxa fica genérico "Taxa marketplace" em vez de nomear uma
  // marketplace específica, que não seria verdade pra todo pedido do arquivo.
  app.get<{ Querystring: { from: string; to: string; format?: 'csv' | 'xlsx' } }>(
    '/orders/export',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const { from, to, format } = request.query;
      if (!from || !to) {
        return reply.status(400).send({ message: 'from e to são obrigatórios.' });
      }

      const orders = await prisma.order.findMany({
        where: {
          shop: { userId: request.user.sub, status: 'active' },
          completedAt: { gte: new Date(from), lt: new Date(to) },
        },
        include: { lineItems: { include: { product: true } }, shop: true },
        orderBy: { orderDate: 'asc' },
      });

      const header = [
        'Data do pedido',
        'Loja',
        'Nº do pedido',
        'Status',
        'Produto',
        'Quantidade',
        'Valor de venda (R$)',
        'Frete alocado (R$)',
        'Taxa marketplace (R$)',
        'Imposto (R$)',
        'Custo do produto (R$)',
        'Lucro (R$)',
      ].join(';');

      if (format === 'xlsx') {
        const xlsxRows: (string | number | Date | null)[][] = [];
        for (const order of orders) {
          const statusStr = STATUS_LABELS[order.orderStatus] ?? order.orderStatus;
          for (const li of order.lineItems) {
            const productName = li.product?.name ?? li.itemName ?? `Item ${li.shopeeItemId ?? '?'}`;
            xlsxRows.push([
              order.orderDate,
              order.shop.shopName,
              order.shopeeOrderSn ?? order.mercadoLivreOrderId ?? '',
              statusStr,
              productName,
              li.quantity,
              Number(li.salePrice),
              Number(li.shippingFeeAllocated),
              Number(li.shopeeFeeAllocated),
              Number(li.taxAllocated),
              li.productCostSnapshot !== null ? Number(li.productCostSnapshot) : null,
              li.profit !== null ? Number(li.profit) : null,
            ]);
          }
        }
        const buffer = await buildOrdersXlsx(header.split(';'), xlsxRows, 'Pedidos');
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        reply.header('Content-Disposition', 'attachment; filename="pedidos-lucrei-todas-as-lojas.xlsx"');
        return reply.send(buffer);
      }

      const rows: string[] = [header];
      for (const order of orders) {
        const dateStr = order.orderDate.toLocaleDateString('pt-BR');
        const statusStr = STATUS_LABELS[order.orderStatus] ?? order.orderStatus;
        for (const li of order.lineItems) {
          const productName = li.product?.name ?? li.itemName ?? `Item ${li.shopeeItemId ?? '?'}`;
          rows.push(
            [
              dateStr,
              csvField(order.shop.shopName),
              csvField(order.shopeeOrderSn ?? order.mercadoLivreOrderId ?? ''),
              csvField(statusStr),
              csvField(productName),
              String(li.quantity),
              csvNumber(Number(li.salePrice)),
              csvNumber(Number(li.shippingFeeAllocated)),
              csvNumber(Number(li.shopeeFeeAllocated)),
              csvNumber(Number(li.taxAllocated)),
              li.productCostSnapshot !== null ? csvNumber(Number(li.productCostSnapshot)) : '',
              li.profit !== null ? csvNumber(Number(li.profit)) : '',
            ].join(';')
          );
        }
      }

      const csv = '﻿' + rows.join('\r\n');

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', 'attachment; filename="pedidos-lucrei-todas-as-lojas.csv"');
      return reply.send(csv);
    }
  );
}
