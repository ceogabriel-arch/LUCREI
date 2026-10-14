import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppTheme } from '@/lib/theme';

// Cartão "vidro fosco" (blur de verdade + reflexo diagonal + borda clara) -
// visual aprovado ao vivo na Início (anel de lucro, Resumo do período) e
// agora espalhado pros cards de dados do resto do app. Só pra SUPERFÍCIE de
// card (resumo, lista, métrica) - botão/CTA continua sólido de propósito,
// senão perde a noção do que é clicável (tudo "flutuando" igual). onPress
// opcional cobre o caso de card que também é clicável (ex: Conquistas abre
// um modal) sem precisar duplicar o visual inteiro com um Pressable à parte.
export function GlassCard({
  children,
  style,
  className = '',
  borderRadius = 24,
  intensity = 35,
  onPress,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  className?: string;
  // 24 = rounded-3xl (cards grandes); passa 16 pra um card tipo StatTile.
  borderRadius?: number;
  intensity?: number;
  onPress?: () => void;
}>) {
  const { scheme, colors: Colors } = useAppTheme();
  const Container = onPress ? Pressable : View;

  return (
    <Container
      onPress={onPress}
      className={`overflow-hidden border ${className}`}
      style={[{ borderRadius, borderColor: `${Colors.text}26` }, style]}>
      <BlurView intensity={intensity} tint={scheme} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={[`${Colors.surfaceAlt}66`, `${Colors.surface}66`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['#FFFFFF29', '#FFFFFF00']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 0.8 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {children}
    </Container>
  );
}
