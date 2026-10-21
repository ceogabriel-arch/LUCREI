import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BlurredValue } from '@/components/blurred-value';
import { useAppTheme } from '@/lib/theme';

type StatTileProps = {
  label: string;
  value: string;
  deltaLabel?: string;
  deltaDirection?: 'up' | 'down';
  /** Whether an increase is favorable for this metric (false for cost-like metrics). */
  positiveIsGood?: boolean;
  /** Pagamento em atraso/limite estourado - esconde o valor em vez de mostrar. */
  blurred?: boolean;
  /** Quando preenchido, mostra um "?" no canto que explica de onde vem o valor. */
  helpText?: string;
  /** Grid de 3 colunas do desktop largo - preenche a célula (sem largura
   * fixa) e usa texto maior. No mobile/scroll horizontal continua com a
   * largura fixa de sempre, que cabe melhor numa fileira que rola de lado. */
  large?: boolean;
  /** "+R$X previsto" - pedido ainda não confirmado (comprado, mas não
   * concluído/pago de verdade) que ainda não entra no valor principal.
   * Neutro de propósito (sem seta, sem verde/vermelho de deltaLabel): não é
   * uma variação do período, é dinheiro que PODE vir a ser confirmado. */
  forecastLabel?: string;
};

export function StatTile({
  label,
  value,
  deltaLabel,
  deltaDirection = 'up',
  positiveIsGood = true,
  blurred = false,
  helpText,
  large = false,
  forecastLabel,
}: StatTileProps) {
  const { scheme, colors: Colors } = useAppTheme();
  const isGood = (deltaDirection === 'up') === positiveIsGood;
  const deltaColor = isGood ? Colors.success : Colors.danger;
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <View
      className={`${large ? 'w-full p-6' : 'w-[152px] p-4'} rounded-2xl border`}
      // A dica escapa da caixa do card (é mais larga que ele) via overflow
      // visible - sem promover o z-index do card INTEIRO (não só do ícone),
      // o próximo card do grid (que vem depois no HTML) pinta por cima
      // dela, cortando/bagunçando visualmente quem passa o mouse.
      // Borda clara (não a cinza padrão) lê como "borda de vidro".
      style={{ overflow: 'visible', zIndex: showTooltip ? 30 : 1, borderColor: `${Colors.text}26` }}>
      {/* Vidro fosco de verdade (desfoca o que está atrás) em vez de só uma
          cor semi-transparente (tentativa anterior não dava pra notar) -
          BlurView próprio (não o View de fora, que precisa de overflow
          visible pra dica) cuida de recortar nos cantos arredondados. O
          sheen diagonal por cima é o brilho/reflexo que faz ler como vidro
          de verdade, não só "card desfocado" (reportado ao vivo que ainda
          não tinha ficado com essa cara). */}
      <BlurView intensity={30} tint={scheme} style={[StyleSheet.absoluteFill, { borderRadius: 16, overflow: 'hidden' }]} />
      <LinearGradient
        colors={['#FFFFFF26', '#FFFFFF00']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.7, y: 0.9 }}
        style={[StyleSheet.absoluteFill, { borderRadius: 16 }]}
        pointerEvents="none"
      />
      {helpText && (
        <>
          <Pressable
            className="absolute right-2.5 top-2.5 z-20"
            // Só onPress (sem hover) - reportado ao vivo que o "?" parava
            // de funcionar num dispositivo híbrido (touchscreen com
            // mouse/trackpad também disponível): o navegador reporta
            // "hover: hover" nesse caso mesmo quando a pessoa está tocando
            // na tela, então a versão anterior desligava o onPress achando
            // que só tinha mouse. onPress sozinho funciona igual em
            // qualquer entrada (toque ou clique), sem precisar adivinhar.
            onPress={() => setShowTooltip((v) => !v)}
            hitSlop={8}>
            <Ionicons name="help-circle-outline" size={large ? 18 : 15} color={Colors.textMuted} />
          </Pressable>
          {showTooltip && (
            <View
              className={`absolute rounded-xl border border-lucrei-border bg-lucrei-bg ${large ? 'w-64 p-3.5' : 'w-40 p-2.5'}`}
              // Acima do card inteiro, não por cima do valor - por cima
              // sobrepondo (top-7) dependia da dica cobrir o card sem sobrar
              // nada, e no web a caixa não ficava opaca o bastante: o texto
              // da dica e o valor (ex.: "R$ 0,00") ficavam se misturando,
              // ilegíveis. "bottom" fixo em pixels (não 'top: 100%') - a
              // caixa cresce pra cima a partir daí sozinha, não depende de
              // saber a altura da dica (que varia com o texto) nem de
              // porcentagem, que quebrou o hover inteiro numa tentativa
              // anterior. O card "large" é bem mais alto (texto 3xl + mais
              // padding), por isso o "bottom" também cresce junto - senão a
              // dica nascia por cima do próprio valor do card grande.
              style={{
                bottom: large ? 150 : 100,
                left: '50%',
                marginLeft: large ? -128 : -80,
                zIndex: 40,
                shadowColor: '#000',
                shadowOpacity: 0.35,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 12,
              }}>
              <Text className={large ? 'text-sm leading-5 text-lucrei-text' : 'text-[11px] leading-4 text-lucrei-text'}>
                {helpText}
              </Text>
            </View>
          )}
        </>
      )}
      <Text className={`pr-4 text-lucrei-textMuted ${large ? 'text-sm' : 'text-xs'}`} numberOfLines={1}>
        {label}
      </Text>
      {blurred ? (
        <View className={large ? 'mt-2.5' : 'mt-1.5'}>
          <BlurredValue width={large ? 110 : 70} height={large ? 30 : 18} />
        </View>
      ) : (
        <Text
          className={`font-semibold text-lucrei-text ${large ? 'mt-2.5 text-3xl' : 'mt-1.5 text-lg'}`}
          numberOfLines={1}>
          {value}
        </Text>
      )}
      {deltaLabel && !blurred ? (
        <View className={`flex-row items-center gap-1 ${large ? 'mt-2' : 'mt-1'}`}>
          <Ionicons
            name={deltaDirection === 'down' ? 'arrow-down' : 'arrow-up'}
            size={large ? 14 : 11}
            color={deltaColor}
          />
          <Text className={large ? 'text-sm' : 'text-xs'} style={{ color: deltaColor }}>
            {deltaLabel}
          </Text>
        </View>
      ) : null}
      {forecastLabel && !blurred ? (
        <Text className={`text-lucrei-textMuted ${large ? 'mt-2 text-sm' : 'mt-1 text-xs'}`} numberOfLines={1}>
          {forecastLabel}
        </Text>
      ) : null}
    </View>
  );
}
