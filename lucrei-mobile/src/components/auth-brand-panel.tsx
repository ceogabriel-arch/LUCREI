import { Image } from 'expo-image';
import { Text, View } from 'react-native';

import { Sparkline } from '@/components/sparkline';

// Sempre a variante "escura" da logo (feita pra fundo preto), independente
// do tema claro/escuro que o usuário escolheu no app - esse painel é a
// identidade visual da marca (preto + dourado), não muda com o tema.
const LOGO = require('../../assets/images/lucrei-logo.png');
const LOGO_ASPECT = 449 / 153;
const LOGO_WIDTH = 220;

const BRAND_BG = '#0A0A0B';
const BRAND_GOLD = '#F5C518';

const TREND = [18, 32, 27, 41, 38, 55, 49, 68, 63, 82, 76, 93];

const TAGLINES = {
  login: 'Veja o lucro real de cada venda, não só o faturamento.',
  signup: 'Acompanhe seu lucro de verdade - leva menos de um minuto pra começar.',
} as const;

export function AuthBrandPanel({ variant }: { variant: keyof typeof TAGLINES }) {
  return (
    <View className="flex-1 items-center justify-center px-12" style={{ backgroundColor: BRAND_BG }}>
      <View style={{ width: LOGO_WIDTH, height: LOGO_WIDTH / LOGO_ASPECT }}>
        <Image source={LOGO} style={{ width: '100%', height: '100%' }} contentFit="contain" />
      </View>

      <Text className="mt-6 max-w-sm text-center text-lg leading-7 text-white/80">{TAGLINES[variant]}</Text>

      <View className="mt-10 items-center">
        <Text className="text-4xl font-bold" style={{ color: BRAND_GOLD }}>
          +93%
        </Text>
        <Text className="mt-1 text-center text-sm text-white/50">de lucro identificado em vendas que pareciam empatar</Text>
        <View className="mt-4">
          <Sparkline data={TREND} width={340} height={80} />
        </View>
      </View>
    </View>
  );
}
