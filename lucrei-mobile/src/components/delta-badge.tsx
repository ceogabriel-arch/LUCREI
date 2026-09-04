import { Ionicons } from '@expo/vector-icons';
import { Text, View } from 'react-native';

import { useColors } from '@/lib/theme';

type DeltaBadgeProps = {
  label: string;
  direction: 'up' | 'down';
  /** Whether an increase is favorable for this metric (false for cost-like metrics). */
  positiveIsGood?: boolean;
};

export function DeltaBadge({ label, direction, positiveIsGood = true }: DeltaBadgeProps) {
  const Colors = useColors();
  const isGood = (direction === 'up') === positiveIsGood;
  const color = isGood ? Colors.success : Colors.danger;
  const backgroundColor = `${color}24`;

  return (
    <View
      className="mt-3 flex-row items-center self-start gap-1 rounded-full px-2.5 py-1"
      style={{ backgroundColor }}>
      <Ionicons name={direction === 'down' ? 'arrow-down' : 'arrow-up'} size={12} color={color} />
      <Text className="text-xs font-medium" style={{ color }}>
        {label}
      </Text>
    </View>
  );
}
