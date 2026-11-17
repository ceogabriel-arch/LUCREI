import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { View } from 'react-native';

import { IfoodLogo } from '@/components/ifood-logo';
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
    return <IfoodLogo size={size} />;
  }

  if (provider === 'tiktok_shop') {
    // Mesmo esquema da iFood: sem tiktokshop-icon.png ainda, usa o logo do
    // próprio Ionicons até existir um ícone isolado em assets/images.
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="logo-tiktok" size={size * 0.82} color={Colors.text} />
      </View>
    );
  }

  const source = provider === 'mercado_livre' ? MERCADOLIVRE_ICON : SHOPEE_ICON;
  return <Image source={source} style={{ width: size, height: size }} contentFit="contain" />;
}
