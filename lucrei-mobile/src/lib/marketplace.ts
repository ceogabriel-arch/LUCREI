export type Marketplace = 'shopee' | 'mercado_livre' | 'ifood' | 'tiktok_shop' | 'food99';

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  shopee: 'Shopee',
  mercado_livre: 'Mercado Livre',
  ifood: 'iFood',
  tiktok_shop: 'TikTok Shop',
  food99: '99Food',
};

// "da Shopee" / "do Mercado Livre" / "da iFood" - usado em frases tipo
// "faturamento do marketplace".
export const MARKETPLACE_LABELS_LOWER: Record<Marketplace, string> = {
  shopee: 'da Shopee',
  mercado_livre: 'do Mercado Livre',
  ifood: 'da iFood',
  tiktok_shop: 'do TikTok Shop',
  food99: 'da 99Food',
};

export const MARKETPLACE_FEE_LABELS: Record<Marketplace, string> = {
  shopee: '− Taxa Shopee',
  mercado_livre: '− Taxa Mercado Livre',
  ifood: '− Comissão iFood',
  tiktok_shop: '− Taxa TikTok Shop',
  food99: '− Comissão 99Food',
};

export function marketplaceLabel(provider: Marketplace): string {
  return MARKETPLACE_LABELS[provider] ?? provider;
}
