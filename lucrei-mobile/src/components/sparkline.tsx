import { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { formatBRL } from '@/lib/format';
import { useColors } from '@/lib/theme';

// Mesma detecção usada no StatTile - mistura de onPress (alternando) com
// onHoverIn/onHoverOut causaria a mesma corrida lá documentada (toque dispara
// hover sintético no navegador), então só um modo de interação por vez.
const supportsHover =
  Platform.OS === 'web' && typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches === true;

type TrendPoint = { date: string; profit: number; ordersCount: number };

type SparklineProps = {
  // Aceita tanto o dado real (com dia/pedidos, habilita a dica ao passar o
  // mouse) quanto uma lista simples de números (usado só decorativamente nas
  // telas de login/cadastro, sem dia nenhum pra mostrar) - sem dois
  // componentes quase iguais pra manter.
  data: number[] | TrendPoint[];
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

// "2026-10-19" -> "19/10", sem passar por Date (evita o dia mudar por causa
// de fuso horário - a string já vem no dia certo do servidor).
function formatShortDate(isoDate: string) {
  const [, month, day] = isoDate.split('-');
  return `${day}/${month}`;
}

export function Sparkline({ data, width = 296, height = 56 }: SparklineProps) {
  const Colors = useColors();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  if (data.length < 2) return null;

  const isInteractive = typeof data[0] === 'object';
  const values = isInteractive ? (data as TrendPoint[]).map((t) => t.profit) : (data as number[]);

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padX = 10;
  const padY = 10;
  const stepX = (width - padX * 2) / (values.length - 1);

  const points = values.map((value, i) => ({
    x: padX + i * stepX,
    y: padY + (height - padY * 2) * (1 - (value - min) / range),
  }));

  const last = points[points.length - 1];
  const hovered = hoveredIndex !== null ? points[hoveredIndex] : null;

  // Caixa de ~120px, grudada acima do ponto - perto das bordas horizontais
  // inverte a posição pra não cortar fora da área do gráfico. Quando o
  // ponto está perto do topo (pico do gráfico), não cabe acima sem
  // sobrepor a própria curva - vira embaixo do ponto nesse caso (achado ao
  // vivo: a dica nascia por cima do pico).
  const tooltipWidth = 120;
  const tooltipHeight = 56;
  const tooltipGap = 22;
  const tooltipLeft = hovered ? Math.min(Math.max(hovered.x - tooltipWidth / 2, 0), width - tooltipWidth) : 0;
  const fitsAbove = hovered ? hovered.y - tooltipHeight - tooltipGap >= 0 : true;
  const tooltipTop = hovered ? (fitsAbove ? hovered.y - tooltipHeight - tooltipGap : hovered.y + tooltipGap) : 0;

  return (
    // overflow visible + zIndex quando tem dica aberta - mesmo motivo do
    // StatTile (ver lá): a dica é mais alta que o gráfico em si, e sem
    // "subir" o container inteiro, a fileira seguinte do card (os anéis,
    // desenhada depois, mesmo nível) pinta por cima e escondia a dica
    // (reportado ao vivo no celular, onde o gráfico é bem baixinho).
    <View style={{ width, height, overflow: 'visible', zIndex: hovered ? 20 : 1 }}>
      <Svg width={width} height={height}>
        <Path d={buildSmoothPath(points)} fill="none" stroke={Colors.gold} strokeWidth={2.5} strokeLinecap="round" />

        {points.slice(0, -1).map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={2.5} fill={Colors.goldDim} opacity={0.6} />
        ))}

        <Circle cx={last.x} cy={last.y} r={10} fill={Colors.gold} opacity={0.18} />
        <Circle cx={last.x} cy={last.y} r={5} fill={Colors.gold} stroke={Colors.surface} strokeWidth={2} />

        {hovered && (
          <>
            <Line x1={hovered.x} y1={padY} x2={hovered.x} y2={height - padY} stroke={Colors.textMuted} strokeWidth={1} opacity={0.4} />
            <Circle cx={hovered.x} cy={hovered.y} r={6} fill={Colors.gold} stroke={Colors.surface} strokeWidth={2} />
          </>
        )}
      </Svg>

      {isInteractive && (
        <View className="absolute inset-0 flex-row">
          {points.map((_, i) => (
            <Pressable
              key={i}
              style={{ width: stepX, marginLeft: i === 0 ? padX - stepX / 2 : 0 }}
              className="h-full"
              onPress={supportsHover ? undefined : () => setHoveredIndex((v) => (v === i ? null : i))}
              onHoverIn={supportsHover ? () => setHoveredIndex(i) : undefined}
              onHoverOut={supportsHover ? () => setHoveredIndex(null) : undefined}
            />
          ))}
        </View>
      )}

      {hovered && isInteractive && (
        <View
          pointerEvents="none"
          className="absolute rounded-lg border border-lucrei-border bg-lucrei-bg px-2.5 py-1.5"
          style={{
            width: tooltipWidth,
            left: tooltipLeft,
            top: tooltipTop,
            shadowColor: '#000',
            shadowOpacity: 0.35,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 10,
            zIndex: 40,
          }}>
          <Text className="text-[11px] text-lucrei-textMuted">{formatShortDate((data as TrendPoint[])[hoveredIndex!].date)}</Text>
          <Text className="text-xs font-semibold text-lucrei-text">{formatBRL((data as TrendPoint[])[hoveredIndex!].profit)}</Text>
          <Text className="text-[11px] text-lucrei-textMuted">
            {(data as TrendPoint[])[hoveredIndex!].ordersCount} {(data as TrendPoint[])[hoveredIndex!].ordersCount === 1 ? 'pedido' : 'pedidos'}
          </Text>
        </View>
      )}
    </View>
  );
}
