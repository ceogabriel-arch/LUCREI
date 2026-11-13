export type Marketplace = 'shopee' | 'mercado_livre' | 'ifood';

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  shopee: 'Shopee',
  mercado_livre: 'Mercado Livre',
  ifood: 'iFood',
};

// "da Shopee" / "do Mercado Livre" / "da iFood" - usado em frases tipo
// "faturamento do marketplace".
export const MARKETPLACE_LABELS_LOWER: Record<Marketplace, string> = {
  shopee: 'da Shopee',
  mercado_livre: 'do Mercado Livre',
  ifood: 'da iFood',
};

export const MARKETPLACE_FEE_LABELS: Record<Marketplace, string> = {
  shopee: '− Taxa Shopee',
  mercado_livre: '− Taxa Mercado Livre',
  ifood: '− Comissão iFood',
};

export function marketplaceLabel(provider: Marketplace): string {
  return MARKETPLACE_LABELS[provider] ?? provider;
}
