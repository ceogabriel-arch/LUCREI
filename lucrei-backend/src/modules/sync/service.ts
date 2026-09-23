import { mapLimit } from '../../lib/concurrency';
import { notifyOrderCompletedIfNeeded } from '../../lib/order-notifications';
import { prisma } from '../../lib/prisma';
import { getValidAccessToken } from '../../lib/shopee-token';
import { getEscrowDetail, getOrderDetail, getOrderList } from '../../shopee-client';
import { allocateLineItem, computeLineProfit, computeOrderTotals } from './order-math';

const ELIGIBLE_STATUSES = new Set(['COMPLETED']);

async function processOrder(
  shopDbId: string,
  shopeeShopId: number,
  accessToken: string,
  orderSn: string,
  orderStatus: string,
  createTime?: number,
  updateTime?: number
) {
  const escrow = await getEscrowDetail(accessToken, shopeeShopId, orderSn);
  const income = escrow.order_income;

  const totals = computeOrderTotals(
    income.items,
    income.actual_shipping_fee,
    income.buyer_paid_shipping_fee,
    income.commission_fee,
    income.service_fee
  );

  // update_time é "última mudança de status" - pra um pedido que só chega
  // aqui depois de virar COMPLETED (ELIGIBLE_STATUSES), na prática é o
  // momento da conclusão, já que esse é o status final. Grava em toda
  // sincronização (não só na criação) pra pedido reprocessado também ficar
  // com a data certa, não só o primeiro registro.
  const completedAt = updateTime ? new Date(updateTime * 1000) : new Date();

  const order = await prisma.order.upsert({
    where: { shopeeOrderSn: orderSn },
    update: {
      orderStatus,
      completedAt,
      buyerPaidShippingFee: income.buyer_paid_shipping_fee,
      escrowAmount: income.escrow_amount,
      escrowSyncedAt: new Date(),
    },
    create: {
      shopId: shopDbId,
      shopeeOrderSn: orderSn,
      orderStatus,
      orderDate: createTime ? new Date(createTime * 1000) : new Date(),
      completedAt,
      buyerPaidShippingFee: income.buyer_paid_shipping_fee,
      escrowAmount: income.escrow_amount,
      escrowSyncedAt: new Date(),
    },
  });

  const itemIds = income.items.map((li) => String(li.item_id));
  const products = await prisma.product.findMany({
    where: { shopId: shopDbId, shopeeItemId: { in: itemIds } },
  });
  const productByItemId = new Map<string, (typeof products)[number]>();
  for (const p of products) {
    if (p.shopeeItemId && !productByItemId.has(p.shopeeItemId)) productByItemId.set(p.shopeeItemId, p);
  }

  let profitSum = 0;
  let itemsMissingCost = 0;

  const lineItemsData = income.items.map((li) => {
    const { lineValue, shippingFeeAllocated, shopeeFeeAllocated } = allocateLineItem(li, totals);
    const product = productByItemId.get(String(li.item_id));

    const productCostSnapshot = product ? Number(product.costPrice) * li.quantity_purchased : null;
    const profit = computeLineProfit(lineValue, shippingFeeAllocated, shopeeFeeAllocated, productCostSnapshot);

    if (profit === null) itemsMissingCost++;
    else profitSum += profit;

    return {
      orderId: order.id,
      productId: product?.id,
      shopeeItemId: String(li.item_id),
      itemName: li.item_name,
      quantity: li.quantity_purchased,
      salePrice: lineValue,
      shippingFeeAllocated,
      shopeeFeeAllocated,
      productCostSnapshot: productCostSnapshot ?? undefined,
      profit: profit ?? undefined,
    };
  });

  // Sincronização normal e backfill de histórico podem processar o MESMO
  // pedido ao mesmo tempo (nada impede os dois de rodar juntos hoje). Sem
  // isso, dois "apaga tudo + recria" concorrentes podiam intercalar (A apaga
  // e recria, B apaga - já vazio - e recria de novo por cima), duplicando os
  // itens do pedido e inflando faturamento/lucro. O lock na linha do Order
  // serializa: quem chegar depois espera o primeiro terminar (e commitar)
  // antes de apagar/recriar, então sempre vê o estado final correto.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
    await tx.orderLineItem.deleteMany({ where: { orderId: order.id } });
    await tx.orderLineItem.createMany({ data: lineItemsData });
  });

  // Segue o mesmo critério da rota de listagem de pedidos: só null quando
  // NENHUM item do pedido tem custo cadastrado.
  const totalProfit = itemsMissingCost === income.items.length ? null : profitSum;
  const totalRevenue = lineItemsData.reduce((sum, li) => sum + li.salePrice, 0);

  // Rede de segurança contra o push da Shopee não avisar (não garante
  // entrega) - roda em toda sincronização, não só quando vem do webhook, mas
  // só manda notificação de verdade se o pedido ainda não tiver sido
  // notificado E tiver completado recentemente (ver notifyOrderCompletedIfNeeded).
  // Nunca deixa uma falha aqui derrubar a sincronização do pedido em si.
  await notifyOrderCompletedIfNeeded({
    orderId: order.id,
    orderSn,
    shopDbId,
    completedAt: order.completedAt,
    totalProfit,
    totalRevenue,
  }).catch(() => {});

  return { orderId: order.id, totalProfit };
}

export async function syncOneOrder(shopId: string, orderSn: string, orderStatus: string) {
  const { accessToken, shopeeShopId } = await getValidAccessToken(shopId);
  const [detail] = await getOrderDetail(accessToken, shopeeShopId, [orderSn]);
  return processOrder(shopId, shopeeShopId, accessToken, orderSn, orderStatus, detail?.create_time, detail?.update_time);
}

// get_order_list da Shopee só aceita um intervalo de até 15 dias por
// chamada - por isso a sincronização do dia a dia (abaixo) e o backfill de
// histórico (mais abaixo) precisam varrer o tempo em blocos desse tamanho.
export const WINDOW_SECONDS = 15 * 24 * 60 * 60;

// Teto de segurança contra um cursor que nunca avança de verdade (a Shopee
// devolver "more: true" com o mesmo next_cursor, por exemplo) - sem isso essa
// paginação girava pra sempre, travando o backfill inteiro num bloco só sem
// nenhum erro pra pegar e seguir adiante. 200 páginas = até 10 mil pedidos
// num bloco de 15 dias, folga boa pra loja de alto volume.
const MAX_PAGES_PER_WINDOW = 200;

// fetchJson já tem timeout por chamada (15s), mas nada limitava o tempo
// total de UM bloco de 15 dias - uma loja com muitos pedidos nesse bloco (ou
// a Shopee respondendo devagar em várias chamadas seguidas) podia deixar o
// backfill parado ali por muito tempo sem sinal de vida nenhum pro app. 3min
// se mostrou baixo demais pra uma loja de alto volume de verdade (um bloco
// com centenas de pedidos, cada um com sua própria chamada de
// get_escrow_detail, passa disso tranquilamente) - 10min dá bem mais folga
// sem deixar de existir um teto.
const WINDOW_TIMEOUT_MS = 10 * 60 * 1000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function syncWindowUnbounded(
  shopId: string,
  shopeeShopId: number,
  accessToken: string,
  timeFrom: number,
  timeTo: number
) {
  let cursor = '';
  let hasMore = true;
  let ordersSeen = 0;
  let ordersSynced = 0;
  let pages = 0;

  while (hasMore) {
    pages++;
    if (pages > MAX_PAGES_PER_WINDOW) {
      throw new Error(`Bloco com mais de ${MAX_PAGES_PER_WINDOW} páginas de pedidos - parando por segurança.`);
    }

    const page = await getOrderList(accessToken, shopeeShopId, { timeFrom, timeTo, cursor });
    ordersSeen += page.order_list.length;

    if (page.order_list.length > 0) {
      // get_order_list nem sempre retorna order_status no item — o status confiável
      // vem do get_order_detail, então buscamos o detalhe de todos antes de filtrar.
      const details = await getOrderDetail(
        accessToken,
        shopeeShopId,
        page.order_list.map((o) => o.order_sn)
      );

      const eligibleDetails = details.filter((detail) => ELIGIBLE_STATUSES.has(detail.order_status));

      // Cada pedido faz sua própria chamada de get_escrow_detail (a Shopee só
      // aceita um order_sn por vez ali) mais algumas idas ao banco - processar
      // um de cada vez fazia a sincronização inteira escalar linearmente com
      // o número de pedidos, dominada por ida-e-volta de rede. 15 (subiu de
      // 10) pra loja de alto volume não passar tanto tempo num bloco só sem
      // estourar o rate limit da Shopee de vez.
      await mapLimit(eligibleDetails, 15, (detail) =>
        processOrder(
          shopId,
          shopeeShopId,
          accessToken,
          detail.order_sn,
          detail.order_status,
          detail.create_time,
          detail.update_time
        )
      );
      ordersSynced += eligibleDetails.length;
    }

    hasMore = page.more;
    cursor = page.next_cursor;
  }

  return { ordersSeen, ordersSynced };
}

async function syncWindow(shopId: string, shopeeShopId: number, accessToken: string, timeFrom: number, timeTo: number) {
  return withTimeout(
    syncWindowUnbounded(shopId, shopeeShopId, accessToken, timeFrom, timeTo),
    WINDOW_TIMEOUT_MS,
    `Bloco de pedidos demorou mais de ${WINDOW_TIMEOUT_MS / 60000} minuto(s) pra responder.`
  );
}

export async function syncShopOrders(shopId: string) {
  const { accessToken, shopeeShopId } = await getValidAccessToken(shopId);

  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - WINDOW_SECONDS;

  const result = await syncWindow(shopId, shopeeShopId, accessToken, timeFrom, timeTo);

  await prisma.shop.update({ where: { id: shopId }, data: { lastSyncedAt: new Date() } });

  return result;
}

// Roda o sync do dia a dia solto em segundo plano, igual ao backfill de
// histórico - travar a sincronização inteira dentro da requisição HTTP
// enquanto o usuário espera é o que mais pesa quando muita gente sincroniza
// ao mesmo tempo (cada requisição presa até terminar, num único processo).
export async function runShopSync(shopId: string) {
  await prisma.shop.update({
    where: { id: shopId },
    data: { syncStatus: 'running', syncStartedAt: new Date(), syncOrdersSynced: null, syncError: null },
  });

  try {
    const result = await syncShopOrders(shopId);
    await prisma.shop.update({
      where: { id: shopId },
      data: { syncStatus: 'done', syncOrdersSynced: result.ordersSynced },
    });
  } catch (err) {
    await prisma.shop.update({
      where: { id: shopId },
      data: { syncStatus: 'error', syncError: err instanceof Error ? err.message : 'Erro desconhecido.' },
    });
  }
}

// Backfill manual (botão "Sincronizar histórico" em Relatórios) - a
// sincronização normal acima só cobre os últimos 15 dias, então pedidos mais
// antigos que isso nunca entram no banco sozinhos. Uma loja com bastante
// histórico facilmente passa dos ~30s que um proxy/navegador aguenta numa
// requisição só, então isso roda solto em segundo plano (a rota só dispara e
// devolve na hora) e grava progresso no próprio Shop, que o app consulta por
// polling em vez de ficar com a requisição HTTP presa esperando.
export async function runHistoryBackfill(shopId: string, sinceDate: Date) {
  await prisma.shop.update({
    where: { id: shopId },
    data: {
      historyBackfillStatus: 'running',
      historyBackfillStartedAt: new Date(),
      historyBackfillDoneAt: null,
      historyBackfillSynced: 0,
      historyBackfillWindowsDone: 0,
      historyBackfillError: null,
    },
  });

  try {
    const { accessToken, shopeeShopId } = await getValidAccessToken(shopId);

    const sinceSec = Math.floor(sinceDate.getTime() / 1000);
    let windowEnd = Math.floor(Date.now() / 1000);
    let ordersSynced = 0;
    let windowsDone = 0;
    let windowsFailed = 0;
    let lastError: unknown = null;

    while (windowEnd > sinceSec) {
      const windowStart = Math.max(sinceSec, windowEnd - WINDOW_SECONDS);
      try {
        const result = await syncWindow(shopId, shopeeShopId, accessToken, windowStart, windowEnd);
        ordersSynced += result.ordersSynced;
      } catch (err) {
        // Um bloco de 15 dias falhar (ex: janela antiga demais pra Shopee
        // aceitar) não pode derrubar o backfill inteiro - registra e segue
        // pros blocos mais recentes, que são os que mais importam.
        windowsFailed++;
        lastError = err;
      }
      windowsDone++;
      // historyBackfillStartedAt também funciona como "último sinal de vida"
      // aqui (ver isBackfillStale em routes.ts) - reescrever a cada bloco, e
      // não só uma vez no início, evita que um backfill de loja grande (pode
      // legitimamente passar de 20min no total, com vários blocos de 10min
      // cada) seja confundido com travado enquanto ainda está progredindo de
      // verdade. windowsDone (contra o total fixo de ~25 blocos pra 1 ano)
      // é o que vira a barra de progresso no app - diferente da contagem de
      // pedidos, esse número sobe de forma previsível independente de quão
      // cheio de vendas cada bloco é.
      await prisma.shop.update({
        where: { id: shopId },
        data: { historyBackfillSynced: ordersSynced, historyBackfillWindowsDone: windowsDone, historyBackfillStartedAt: new Date() },
      });
      windowEnd = windowStart;
    }

    if (ordersSynced === 0 && windowsFailed > 0 && lastError instanceof Error) {
      throw lastError;
    }

    // Backfill parcial (alguns blocos de 15 dias falharam, mas outros
    // trouxeram pedido) ainda termina como "done" - senão um erro isolado
    // num bloco antigo faria parecer que nada funcionou. Mas sem registrar
    // qual foi o erro, meses que ficaram sem dado não têm explicação nenhuma
    // visível pra ninguém depois.
    const partialFailureNote =
      windowsFailed > 0
        ? `${windowsFailed} bloco(s) de 15 dias não puderam ser buscados (último erro: ${
            lastError instanceof Error ? lastError.message : 'desconhecido'
          }). Meses cobertos só por esses blocos podem ter ficado sem pedido.`
        : null;

    await prisma.shop.update({
      where: { id: shopId },
      data: {
        historyBackfillStatus: 'done',
        historyBackfillDoneAt: new Date(),
        lastSyncedAt: new Date(),
        historyBackfillError: partialFailureNote,
      },
    });
  } catch (err) {
    await prisma.shop.update({
      where: { id: shopId },
      data: {
        historyBackfillStatus: 'error',
        historyBackfillDoneAt: new Date(),
        historyBackfillError: err instanceof Error ? err.message : 'Erro desconhecido.',
      },
    });
  }
}
