import { LinearGradient } from 'expo-linear-gradient';
import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
        // Mais alto que só o cabeçalho (340 -> 640) de propósito - os cards
        // "vidro" (BlurView) mais abaixo na tela (Resumo do período) ficam
        // sobre fundo liso sem isso, e desfocar uma cor sólida não muda nada
        // visualmente (reportado ao vivo: "não ficou com aspecto de vidro").
        // O degradê precisa continuar até onde esses cards aparecem pra ter
        // alguma variação de cor por trás pro blur realmente suavizar.
        <LinearGradient
          colors={[`${Colors.goldDim}40`, `${Colors.goldDim}00`]}
          locations={[0, 1]}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 640 }}
        />
      )}
      {/* Sem o teto de largura aqui de propósito (ver webCapWidth) - isso
          encolhia o ScrollView de cada tela pra uma coluna estreita
          centralizada, e a margem preta dos dois lados ficava sem NADA
          rolável embaixo do mouse (reportado ao vivo: "scroll não funciona"
          sobre essas colunas vazias). O teto de largura agora é aplicado no
          contentContainerStyle do ScrollView de cada tela (ver cada uma) -
          a área que rola continua a largura inteira, só o conteúdo visível
          fica centralizado dentro dela. */}
      <View className="flex-1 px-5 pt-6">
        {children}
      </View>
    </SafeAreaView>
  );
}
