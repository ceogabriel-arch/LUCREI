import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';

import { BlurredValue } from '@/components/blurred-value';
import { useColors } from '@/lib/theme';

// Toque em touchscreen dispara hover sintético (mouseenter/mouseleave) no
// navegador, então misturar onPress (alternando) com onHoverIn/onHoverOut
// (web) causava uma corrida: o toque abria pelo hover e fechava em seguida
// pelo próprio toque, cancelando um ao outro - "toca e não acontece nada".
// Detectando se o dispositivo tem hover de verdade, usa só um jeito de
// interação por vez: hover no mouse, toque alternando em quem não tem mouse.
const supportsHover =
  Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches === true;

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
}: StatTileProps) {
  const Colors = useColors();
  const isGood = (deltaDirection === 'up') === positiveIsGood;
  const deltaColor = isGood ? Colors.success : Colors.danger;
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <View
      className={`${large ? 'w-full p-6' : 'w-[152px] p-4'} rounded-2xl border border-lucrei-border bg-lucrei-surface`}
      // A dica escapa da caixa do card (é mais larga que ele) via overflow
      // visible - sem promover o z-index do card INTEIRO (não só do ícone),
      // o próximo card do grid (que vem depois no HTML) pinta por cima
      // dela, cortando/bagunçando visualmente quem passa o mouse.
      style={{ overflow: 'visible', zIndex: showTooltip ? 30 : 1 }}>
      {helpText && (
        <>
          <Pressable
            className="absolute right-2.5 top-2.5 z-20"
            onPress={supportsHover ? undefined : () => setShowTooltip((v) => !v)}
            onHoverIn={supportsHover ? () => setShowTooltip(true) : undefined}
            onHoverOut={supportsHover ? () => setShowTooltip(false) : undefined}
            hitSlop={8}>
            <Ionicons name="help-circle-outline" size={large ? 18 : 15} color={Colors.textMuted} />
          </Pressable>
          {showTooltip && (
            <View
              className="absolute w-40 rounded-xl border border-lucrei-border bg-lucrei-bg p-2.5"
              // Acima do card inteiro, não por cima do valor - por cima
              // sobrepondo (top-7) dependia da dica cobrir o card sem sobrar
              // nada, e no web a caixa não ficava opaca o bastante: o texto
              // da dica e o valor (ex.: "R$ 0,00") ficavam se misturando,
              // ilegíveis. "bottom" fixo em pixels (não 'top: 100%') - a
              // caixa cresce pra cima a partir daí sozinha, não depende de
              // saber a altura da dica (que varia com o texto) nem de
              // porcentagem, que quebrou o hover inteiro numa tentativa
              // anterior. 100px garante que o "bottom" fique acima até da
              // variante mais alta do card (com linha de delta).
              style={{
                bottom: 100,
                left: '50%',
                marginLeft: -80,
                zIndex: 40,
                shadowColor: '#000',
                shadowOpacity: 0.35,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 12,
              }}>
              <Text className="text-[11px] leading-4 text-lucrei-text">{helpText}</Text>
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
    </View>
  );
}
