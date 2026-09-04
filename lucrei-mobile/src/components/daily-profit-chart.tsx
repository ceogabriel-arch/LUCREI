import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';

import { formatBRL } from '@/lib/format';
import { useColors } from '@/lib/theme';

type DayPoint = { date: string; profit: number };

const dayFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

export function DailyProfitChart({ data, height = 140 }: { data: DayPoint[]; height?: number }) {
  const Colors = useColors();
  const [selected, setSelected] = useState(data.length > 0 ? data[data.length - 1] : null);

  if (data.length === 0) {
    return <Text className="text-sm text-lucrei-textMuted">Sem pedidos nesse período pra montar o gráfico.</Text>;
  }

  const maxAbs = Math.max(...data.map((d) => Math.abs(d.profit)), 1);
  const padX = 4;
  const gap = 3;
  const width = 296;
  const barWidth = Math.max((width - padX * 2 - gap * (data.length - 1)) / data.length, 3);
  const zeroY = height / 2;
  const scale = (height / 2 - 8) / maxAbs;

  return (
    <View>
      <View className="flex-row items-baseline justify-between">
        <Text className="text-xs text-lucrei-textMuted">
          {selected ? dayFormatter.format(new Date(selected.date)) : ''}
        </Text>
        <Text
          className="text-sm font-semibold"
          style={{ color: selected && selected.profit < 0 ? Colors.danger : Colors.success }}>
          {selected ? formatBRL(selected.profit) : ''}
        </Text>
      </View>

      <View style={{ width, height, marginTop: 8 }}>
        <Svg width={width} height={height}>
          <Line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke={Colors.border} strokeWidth={1} />
          {data.map((d, i) => {
            const barHeight = Math.max(Math.abs(d.profit) * scale, 2);
            const x = padX + i * (barWidth + gap);
            const y = d.profit >= 0 ? zeroY - barHeight : zeroY;
            const isSelected = selected?.date === d.date;
            return (
              <Rect
                key={d.date}
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={Math.min(2, barWidth / 2)}
                fill={d.profit >= 0 ? Colors.success : Colors.danger}
                opacity={isSelected ? 1 : 0.55}
              />
            );
          })}
        </Svg>

        {data.map((d, i) => (
          <Pressable
            key={d.date}
            onPress={() => setSelected(d)}
            style={{ position: 'absolute', left: padX + i * (barWidth + gap), top: 0, width: barWidth, height }}
          />
        ))}
      </View>
    </View>
  );
}
