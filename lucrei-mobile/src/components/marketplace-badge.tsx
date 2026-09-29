import { Image } from 'expo-image';

const SHOPEE_ICON = require('../../assets/images/shopee-icon.png');
const MERCADOLIVRE_ICON = require('../../assets/images/mercadolivre-icon.png');

// Ícone isolado de cada marketplace (fundo transparente de verdade, não só
// aparência de branco) - usado como badge pequeno ao lado do nome da loja
// em qualquer lugar do app (seletor de loja, "Lojas conectadas", lucro por
// loja no Início).
export function MarketplaceBadge({ provider, size = 22 }: { provider: 'shopee' | 'mercado_livre'; size?: number }) {
  const source = provider === 'mercado_livre' ? MERCADOLIVRE_ICON : SHOPEE_ICON;
  return <Image source={source} style={{ width: size, height: size }} contentFit="contain" />;
}
