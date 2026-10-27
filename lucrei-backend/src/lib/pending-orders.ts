import type { Shop } from '@prisma/client';

import { rangeStart } from './period';
import { ML_RESOLVED_STATUSES } from '../modules/sync/mercadolivre-service';
import { SHOPEE_PENDING_STATUSES } from '../modules/sync/service';

// Pedido pendente há mais tempo que isso provavelmente perdeu o rastro (push
// da Shopee não garante entrega, e o sync periódico do ML só vê o que ainda
// está nas primeiras páginas de busca) - não entra mais na previsão pra não
// inflar a contagem pra sempre com pedido "fantasma".
export const pendingWindowStart = () => rangeStart('30d');

// Shopee agora sincroniza (e já calcula taxa/frete/lucro de verdade) assim
// que o pedido é pago, não só quando conclui - ver isEligibleShopeeStatus em
// sync/service.ts. Por isso "pendente" aqui encolheu: só sobra o pedido que
// ainda nem foi pago de verdade (SHOPEE_PENDING_STATUSES), já que o resto já
// tem número real no resumo/Order. Sem isso o mesmo pedido contaria duas
// vezes - uma no resumo de verdade, outra estimado aqui.
export function pendingWhereForShop(shop: Shop) {
  return shop.provider === 'mercado_livre'
    ? { shopId: shop.id, mercadoLivreOrderId: { not: null }, orderStatus: { notIn: [...ML_RESOLVED_STATUSES] } }
    : { shopId: shop.id, shopeeOrderSn: { not: null }, orderStatus: { in: [...SHOPEE_PENDING_STATUSES] } };
}
