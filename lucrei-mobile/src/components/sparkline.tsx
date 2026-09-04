import Svg, { Circle, Path } from 'react-native-svg';

import { useColors } from '@/lib/theme';

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
};

function buildSmoothPath(points: { x: number; y: number }[]) {
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const midX = (p0.x + p1.x) / 2;
    const midY = (p0.y + p1.y) / 2;
    d += ` Q ${p0.x} ${p0.y} ${midX} ${midY}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

export function Sparkline({ data, width = 296, height = 56 }: SparklineProps) {
  const Colors = useColors();
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padX = 10;
  const padY = 10;
  const stepX = (width - padX * 2) / (data.length - 1);

  const points = data.map((value, i) => ({
    x: padX + i * stepX,
    y: padY + (height - padY * 2) * (1 - (value - min) / range),
  }));

  const last = points[points.length - 1];

  return (
    <Svg width={width} height={height}>
      <Path d={buildSmoothPath(points)} fill="none" stroke={Colors.gold} strokeWidth={2.5} strokeLinecap="round" />

      {points.slice(0, -1).map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={Colors.goldDim} opacity={0.6} />
      ))}

      <Circle cx={last.x} cy={last.y} r={10} fill={Colors.gold} opacity={0.18} />
      <Circle cx={last.x} cy={last.y} r={5} fill={Colors.gold} stroke={Colors.surface} strokeWidth={2} />
    </Svg>
  );
}
