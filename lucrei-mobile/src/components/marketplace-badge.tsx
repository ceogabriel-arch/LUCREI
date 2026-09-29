import { Image } from 'expo-image';
import { View } from 'react-native';

const SHOPEE_BADGE = require('../../assets/images/shopee-badge.png');
const MERCADOLIVRE_BADGE = require('../../assets/images/mercadolivre-badge.png');

// Os dois PNGs já vêm prontos (pílula com logo + nome, fundo preto próprio)
// desde o commit inicial do projeto, só nunca tinham sido usados em lugar
// nenhum do app ainda. contentFit="contain" evita esticar mesmo que a
// proporção real de cada um varie um pouco.
export function MarketplaceBadge({ provider, height = 22 }: { provider: 'shopee' | 'mercado_livre'; height?: number }) {
  const source = provider === 'mercado_livre' ? MERCADOLIVRE_BADGE : SHOPEE_BADGE;
  return (
    <View style={{ height, width: height * 2.2, borderRadius: height * 0.2, overflow: 'hidden' }}>
      <Image source={source} style={{ width: '100%', height: '100%' }} contentFit="cover" />
    </View>
  );
}
