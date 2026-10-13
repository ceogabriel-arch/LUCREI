import { LinearGradient } from 'expo-linear-gradient';
import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { webCapWidth } from '@/lib/responsive';
import { useColors } from '@/lib/theme';

export function Screen({
  children,
  // Degradê dourado-pra-preto no topo, estilo Revolut (pedido do usuário,
  // print em anexo) - opt-in por tela (começando só pela Início como
  // piloto) pra não mexer em todas de uma vez só. Fica atrás do conteúdo,
  // sangrando até a borda do SafeAreaView (não leva o padding px-5/pt-6
  // de baixo, senão ficaria preso dentro da margem em vez de "atrás" dela).
  headerGradient = false,
}: PropsWithChildren<{ headerGradient?: boolean }>) {
  const Colors = useColors();
  return (
    <SafeAreaView className="flex-1 bg-lucrei-bg">
      {headerGradient && (
        <LinearGradient
          colors={[`${Colors.goldDim}40`, `${Colors.goldDim}00`]}
          locations={[0, 1]}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 340 }}
        />
      )}
      <View className="flex-1 px-5 pt-6" style={webCapWidth()}>
        {children}
      </View>
    </SafeAreaView>
  );
}
