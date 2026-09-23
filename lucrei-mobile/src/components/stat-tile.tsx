import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { BlurredValue } from '@/components/blurred-value';
import { useColors } from '@/lib/theme';

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
};

export function StatTile({
  label,
  value,
  deltaLabel,
  deltaDirection = 'up',
  positiveIsGood = true,
  blurred = false,
  helpText,
}: StatTileProps) {
  const Colors = useColors();
  const isGood = (deltaDirection === 'up') === positiveIsGood;
  const deltaColor = isGood ? Colors.success : Colors.danger;
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <View className="w-[152px] rounded-2xl border border-lucrei-border bg-lucrei-surface p-4" style={{ overflow: 'visible' }}>
      {helpText && (
        <View className="absolute right-2.5 top-2.5 z-20">
          <Pressable
            onPress={() => setShowTooltip((v) => !v)}
            onHoverIn={() => setShowTooltip(true)}
            onHoverOut={() => setShowTooltip(false)}
            hitSlop={8}>
            <Ionicons name="help-circle-outline" size={15} color={Colors.textMuted} />
          </Pressable>
          {showTooltip && (
            <View
              className="absolute right-0 top-6 w-44 rounded-xl border border-lucrei-border bg-lucrei-bg p-2.5"
              style={{ shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 12 }}>
              <Text className="text-[11px] leading-4 text-lucrei-text">{helpText}</Text>
            </View>
          )}
        </View>
      )}
      <Text className="pr-4 text-xs text-lucrei-textMuted" numberOfLines={1}>
        {label}
      </Text>
      {blurred ? (
        <View className="mt-1.5">
          <BlurredValue width={70} height={18} />
        </View>
      ) : (
        <Text className="mt-1.5 text-lg font-semibold text-lucrei-text" numberOfLines={1}>
          {value}
        </Text>
      )}
      {deltaLabel && !blurred ? (
        <View className="mt-1 flex-row items-center gap-1">
          <Ionicons
            name={deltaDirection === 'down' ? 'arrow-down' : 'arrow-up'}
            size={11}
            color={deltaColor}
          />
          <Text className="text-xs" style={{ color: deltaColor }}>
            {deltaLabel}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
