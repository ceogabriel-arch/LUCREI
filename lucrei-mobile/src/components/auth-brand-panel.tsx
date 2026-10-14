import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { Sparkline } from '@/components/sparkline';

// Sempre a variante "escura" da logo (feita pra fundo preto), independente
// do tema claro/escuro que o usuário escolheu no app - esse painel é a
// identidade visual da marca (preto + dourado), não muda com o tema.
const LOGO = require('../../assets/images/lucrei-logo.png');
const LOGO_ASPECT = 449 / 153;
const LOGO_WIDTH = 240;

// #0A0A0B é o MESMO preto do fundo do resto da página (lucrei-bg) - um
// painel "cheio" dessa cor ficava idêntico ao vazio ao redor, sem nenhum
// contraste (reclamado ao vivo: tela de login "sem impacto" comparada a
// uma referência com painel de cor sólida preenchendo a metade da tela de
// verdade). O gradiente (ainda preto, não muda a identidade visual) mais o
// brilho dourado e a borda à direita são o que cria a separação "dois
// painéis" que faltava, mesmo as duas metades sendo da mesma paleta.
const BRAND_BG_FROM = '#0A0A0B';
const BRAND_BG_TO = '#15110A';
const BRAND_GOLD = '#F5C518';

const TREND = [18, 32, 27, 41, 38, 55, 49, 68, 63, 82, 76, 93];

const TAGLINES = {
  login: 'Veja o lucro real de cada venda, não só o faturamento.',
  signup: 'Acompanhe seu lucro de verdade - leva menos de um minuto pra começar.',
} as const;

export function AuthBrandPanel({ variant }: { variant: keyof typeof TAGLINES }) {
  return (
    <View
      className="flex-1 items-center justify-center px-12"
      style={{ borderRightWidth: 1, borderRightColor: 'rgba(245,197,24,0.12)' }}>
      <LinearGradient
        colors={[BRAND_BG_FROM, BRAND_BG_TO]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Brilho dourado suave ancorado embaixo à esquerda - mesmo truque de
          "sheen" diagonal já usado nos StatTile, só que bem mais sutil e
          grande aqui, pra dar profundidade sem competir com o texto. */}
      <LinearGradient
        colors={['rgba(245,197,24,0.14)', 'rgba(245,197,24,0)']}
        start={{ x: 0, y: 1 }}
        end={{ x: 0.7, y: 0.2 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={{ width: LOGO_WIDTH, height: LOGO_WIDTH / LOGO_ASPECT }}>
        <Image source={LOGO} style={{ width: '100%', height: '100%' }} contentFit="contain" />
      </View>

      <Text className="mt-8 max-w-lg text-center text-4xl font-bold leading-[44px] text-white">{TAGLINES[variant]}</Text>

      <View className="mt-14 items-center">
        <Text className="text-7xl font-bold" style={{ color: BRAND_GOLD }}>
          +93%
        </Text>
        <Text className="mt-2 text-center text-base text-white/50">de lucro identificado em vendas que pareciam empatar</Text>
        <View className="mt-6">
          <Sparkline data={TREND} width={420} height={110} />
        </View>
      </View>
    </View>
  );
}
