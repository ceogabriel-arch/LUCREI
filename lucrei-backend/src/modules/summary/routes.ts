import type { FastifyInstance } from 'fastify';
import type { Shop } from '@prisma/client';

import { prisma } from '../../lib/prisma';
import { rangeStart, type Period } from '../../lib/period';

type SummaryQuery = { period?: Period; from?: string; to?: string };

type ShopSummary = {
  revenue: number;
  // Só usado internamente pra recalcular profitMargin de forma correta ao
  // somar várias lojas (não é devolvido pra fora) - profitMargin sozinho não
  // dá pra "desfazer" sem isso.
  revenueWithKnownCost: number;
  cost: number;
  shippingCost: number;
  shopeeFees: number;
  productCost: number;
  taxCost: number;
  profit: number;
  ordersCount: number;
  avgTicket: number;
  profitMargin: number;
  itemsMissingCost: number;
  trend: { date: string; profit: number }[];
};

// Extraído pra ser chamado uma vez por loja tanto na rota de uma loja só
// quanto na combinada (soma de todas) - o cálculo em si (quais pedidos
// entram, como o lucro é rateado) é idêntico nos dois casos, só muda se o
// resultado de uma loja é devolvido puro ou somado com o das outras.
export async function computeShopSummary(shop: Shop, query: SummaryQuery): Promise<ShopSummary> {
  // from/to (usado pelo relatório por ano/mês) manda mais que period -
  // permite um intervalo arbitrário em vez dos presets fixos.
  const fromDate = query.from ? new Date(query.from) : null;
  const toDate = query.to ? new Date(query.to) : null;

  const period = query.period ?? '30d';
  // "all" (usado pro lucro vitalício das recompensas) não pode contar
  // pedidos de antes de conectar a loja no Lucrei - senão uma loja com
  // histórico de vendas na Shopee desbloquearia recompensa na hora de
  // conectar, sem o usuário ter usado o app pra nada ainda. Esse caso
  // continua olhando orderDate (data da compra) de propósito - é sobre
  // quando a VENDA aconteceu em relação a conectar a loja, não sobre
  // quando o lucro ficou confirmado.
  const isLifetimeRewardsQuery = !fromDate && period === 'all';
  const start = fromDate ?? (period === 'all' ? shop.connectedAt : rangeStart(period));

  // Demais casos (presets Hoje/7 dias/30 dias e o from/to dos relatórios
  // por mês/ano) filtram por completedAt: o lucro só existe de fato
  // depois do pedido completar, então "Hoje" precisa dizer "completou
  // hoje", não "foi comprado hoje" (que normalmente é outro dia).
  const orders = isLifetimeRewardsQuery
    ? await prisma.order.findMany({
        where: { shopId: shop.id, orderDate: { gte: start, ...(toDate ? { lt: toDate } : {}) } },
        include: { lineItems: true },
        orderBy: { orderDate: 'asc' },
      })
    : await prisma.order.findMany({
        where: { shopId: shop.id, completedAt: { gte: start, ...(toDate ? { lt: toDate } : {}) } },
        include: { lineItems: true },
        orderBy: { orderDate: 'asc' },
      });

  let revenue = 0;
  let revenueWithKnownCost = 0;
  let profit = 0;
  let shippingCost = 0;
  let shopeeFees = 0;
  let productCost = 0;
  let taxCost = 0;
  let itemsMissingCost = 0;
  const profitByDay = new Map<string, number>();

  for (const order of orders) {
    const day = (order.completedAt ?? order.orderDate).toISOString().slice(0, 10);
    for (const li of order.lineItems) {
      const sale = Number(li.salePrice);
      revenue += sale;

      if (li.profit !== null) {
        revenueWithKnownCost += sale;
        profit += Number(li.profit);
        shippingCost += Number(li.shippingFeeAllocated);
        shopeeFees += Number(li.shopeeFeeAllocated);
        productCost += Number(li.productCostSnapshot ?? 0);
        taxCost += Number(li.taxAllocated);
        profitByDay.set(day, (profitByDay.get(day) ?? 0) + Number(li.profit));
      } else {
        itemsMissingCost++;
      }
    }
  }

  const cost = shippingCost + shopeeFees + productCost + taxCost;
  const ordersCount = orders.length;
  const avgTicket = ordersCount > 0 ? revenue / ordersCount : 0;
  const profitMargin = revenueWithKnownCost > 0 ? (profit / revenueWithKnownCost) * 100 : 0;
  const trend = Array.from(profitByDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, profit]) => ({ date, profit }));

  return { revenue, revenueWithKnownCost, cost, shippingCost, shopeeFees, productCost, taxCost, profit, ordersCount, avgTicket, profitMargin, itemsMissingCost, trend };
}

function combineSummaries(summaries: ShopSummary[]): ShopSummary {
  const revenue = summaries.reduce((sum, s) => sum + s.revenue, 0);
  const cost = summaries.reduce((sum, s) => sum + s.cost, 0);
  const shippingCost = summaries.reduce((sum, s) => sum + s.shippingCost, 0);
  const shopeeFees = summaries.reduce((sum, s) => sum + s.shopeeFees, 0);
  const productCost = summaries.reduce((sum, s) => sum + s.productCost, 0);
  const taxCost = summaries.reduce((sum, s) => sum + s.taxCost, 0);
  const profit = summaries.reduce((sum, s) => sum + s.profit, 0);
  const ordersCount = summaries.reduce((sum, s) => sum + s.ordersCount, 0);
  const itemsMissingCost = summaries.reduce((sum, s) => sum + s.itemsMissingCost, 0);
  // avgTicket/profitMargin recalculados sobre os totais somados, não é média
  // das médias de cada loja (isso distorceria o resultado quando as lojas
  // têm volumes bem diferentes entre si).
  const revenueWithKnownCost = summaries.reduce((sum, s) => sum + s.revenueWithKnownCost, 0);
  const avgTicket = ordersCount > 0 ? revenue / ordersCount : 0;
  const profitMargin = revenueWithKnownCost > 0 ? (profit / revenueWithKnownCost) * 100 : 0;

  const trendByDay = new Map<string, number>();
  for (const s of summaries) {
    for (const point of s.trend) {
      trendByDay.set(point.date, (trendByDay.get(point.date) ?? 0) + point.profit);
    }
  }
  const trend = Array.from(trendByDay.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, profit]) => ({ date, profit }));

  return { revenue, revenueWithKnownCost, cost, shippingCost, shopeeFees, productCost, taxCost, profit, ordersCount, avgTicket, profitMargin, itemsMissingCost, trend };
}

export async function summaryRoutes(app: FastifyInstance) {
  app.get<{ Params: { shopId: string }; Querystring: SummaryQuery }>(
    '/shops/:shopId/summary',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const shop = await prisma.shop.findFirst({
        where: { id: request.params.shopId, userId: request.user.sub },
      });
      if (!shop) return reply.status(404).send({ message: 'Loja não encontrada.' });

      return computeShopSummary(shop, request.query);
    }
  );

  // Soma o resumo de todas as lojas ativas da conta (qualquer marketplace) -
  // usado pro "Todas as lojas" no Início e pelo lucro vitalício das
  // recompensas (que sempre foi combinado no backend do resgate em si, só a
  // tela ainda mostrava só uma loja).
  app.get<{ Querystring: SummaryQuery }>('/summary', { onRequest: [app.authenticate] }, async (request) => {
    const shops = await prisma.shop.findMany({ where: { userId: request.user.sub, status: 'active' } });
    if (shops.length === 0) {
      return { revenue: 0, cost: 0, shippingCost: 0, shopeeFees: 0, productCost: 0, profit: 0, ordersCount: 0, avgTicket: 0, profitMargin: 0, itemsMissingCost: 0, trend: [] };
    }
    const summaries = await Promise.all(shops.map((shop) => computeShopSummary(shop, request.query)));
    return combineSummaries(summaries);
  });
}
