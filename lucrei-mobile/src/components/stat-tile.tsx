import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

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
};

export function StatTile({
  label,
  value,
  deltaLabel,
  deltaDirection = 'up',
  positiveIsGood = true,
  blurred = false,
}: StatTileProps) {
  const Colors = useColors();
  const isGood = (deltaDirection === 'up') === positiveIsGood;
  const deltaColor = isGood ? Colors.success : Colors.danger;

  return (
    <View className="w-[152px] rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
      <Text className="text-xs text-lucrei-textMuted" numberOfLines={1}>
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
