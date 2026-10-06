import { Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import type { Summary } from '@/lib/api';
import { formatBRL } from '@/lib/format';
import { useColors } from '@/lib/theme';

type Segment = { label: string; value: number; color: string };

function DonutRing({ segments, size, strokeWidth }: { segments: Segment[]; size: number; strokeWidth: number }) {
  const Colors = useColors();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + Math.max(s.value, 0), 0);

  let cumulative = 0;
  return (
    <Svg width={size} height={size}>
      <G rotation={-90} originX={size / 2} originY={size / 2}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={Colors.surfaceAlt} strokeWidth={strokeWidth} fill="none" />
        {total > 0 &&
          segments.map((seg, i) => {
            const value = Math.max(seg.value, 0);
            if (value <= 0) return null;
            const dash = (value / total) * circumference;
            const offset = -cumulative;
            cumulative += dash;
            return (
              <Circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={offset}
                fill="none"
              />
            );
          })}
      </G>
    </Svg>
  );
}

// Anel colorido "pra onde foi o dinheiro", estilo painel do UpSeller - ao
// lado do valor de lucro em destaque, mesma fonte de dados que o card "Pra
// onde foi o dinheiro" em Relatórios (CostBar), só em formato de rosca em
// vez de barra. Pedido pelo usuário como atalho visual pro mesmo cálculo.
export function ProfitBreakdownDonut({
  summary,
  size = 96,
  strokeWidth = 14,
  legend = true,
}: {
  summary: Summary;
  size?: number;
  strokeWidth?: number;
  // false quando a tela já mostra o detalhamento em outro lugar (ex: as
  // CostBar em Relatórios) - evita repetir o mesmo valor duas vezes.
  legend?: boolean;
}) {
  const Colors = useColors();

  const segments: Segment[] = [
    { label: 'Custo do produto', value: summary.productCost, color: Colors.goldDim },
    { label: 'Taxas', value: summary.shopeeFees, color: Colors.danger },
    { label: 'Frete', value: summary.shippingCost, color: Colors.textMuted },
    ...(summary.taxCost > 0 ? [{ label: 'Imposto', value: summary.taxCost, color: Colors.danger }] : []),
    { label: 'Lucro', value: Math.max(summary.profit, 0), color: Colors.gold },
  ];
  const visible = segments.filter((s) => s.value > 0);

  if (visible.length === 0) return null;

  return (
    <View className="items-center">
      <DonutRing segments={segments} size={size} strokeWidth={strokeWidth} />
      {legend && (
        <View className="mt-3 gap-1">
          {visible.map((s) => (
            <View key={s.label} className="flex-row items-center gap-1.5">
              <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: s.color }} />
              <Text className="text-xs text-lucrei-textMuted">
                {s.label} · {formatBRL(s.value)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
