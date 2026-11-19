import type { Shop } from '@prisma/client';

// Loja fake usada só pra revisão da Apple (App Store Connect > App Review
// Information) - pedidos e produtos são pré-cadastrados direto no banco,
// sem nenhuma conta de marketplace real por trás. Essa loja nunca tem (nem
// vai ter) um token OAuth válido, então qualquer tentativa de sincronizar
// de verdade com o marketplace falha com "Loja sem token de acesso salvo.".
export function isDemoShop(
  shop: Pick<Shop, 'shopeeShopId' | 'mercadoLivreShopId' | 'ifoodShopId' | 'tiktokShopId'>
): boolean {
  return (
    !!shop.shopeeShopId?.startsWith('demo-') ||
    !!shop.mercadoLivreShopId?.startsWith('demo-') ||
    !!shop.ifoodShopId?.startsWith('demo-') ||
    !!shop.tiktokShopId?.startsWith('demo-')
  );
}
