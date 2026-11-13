import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { View } from 'react-native';

import type { Marketplace } from '@/lib/marketplace';
import { useColors } from '@/lib/theme';

const SHOPEE_ICON = require('../../assets/images/shopee-icon.png');
const MERCADOLIVRE_ICON = require('../../assets/images/mercadolivre-icon.png');

// Ícone isolado de cada marketplace (fundo transparente de verdade, não só
// aparência de branco) - usado como badge pequeno ao lado do nome da loja
// em qualquer lugar do app (seletor de loja, "Lojas conectadas", lucro por
// loja no Início).
export function MarketplaceBadge({ provider, size = 22 }: { provider: Marketplace; size?: number }) {
  const Colors = useColors();

  if (provider === 'ifood') {
    // Sem ícone isolado da iFood ainda (ver os outros dois em
    // assets/images) - usa um ícone genérico até existir um ifood-icon.png.
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="fast-food-outline" size={size * 0.82} color={Colors.text} />
      </View>
    );
  }

  const source = provider === 'mercado_livre' ? MERCADOLIVRE_ICON : SHOPEE_ICON;
  return <Image source={source} style={{ width: size, height: size }} contentFit="contain" />;
}
