import { Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import type { Summary } from '@/lib/api';
import { formatBRL } from '@/lib/format';
import { useColors } from '@/lib/theme';

type Segment = { label: string; value: number; color: string };

function DonutRing({
  segments,
  size,
  strokeWidth,
  total,
}: {
  segments: Segment[];
  size: number;
  strokeWidth: number;
  // Base do anel (100%) - precisa ser passado explicitamente em vez de
  // somar os segmentos: taxa/frete/imposto somam TODO item vendido, mas
  // custo do produto/lucro só somam item com custo cadastrado (ver
  // summary/routes.ts), então os segmentos quase nunca somam o faturamento
  // real. Sem esse "total" certo, a fatia de taxa aparecia proporcionalmente
  // bem maior do que o % mostrado do lado (bug reportado ao vivo) e não
  // sobrava nenhum espaço cinza representando o que ainda está sem custo.
  total: number;
}) {
  const Colors = useColors();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

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

// Anel só de faturamento (um segmento só, 100%) - pedido pelo usuário pra
// ficar ao lado (à esquerda) do anel de custos/taxas, igual par de métricas
// do UpSeller (cada uma com seu próprio anel, lado a lado).
export function RevenueRing({ revenue, size = 96, strokeWidth = 14 }: { revenue: number; size?: number; strokeWidth?: number }) {
  const Colors = useColors();
  if (revenue <= 0) return null;

  return (
    <View className="items-center">
      <DonutRing
        segments={[{ label: 'Faturamento', value: revenue, color: Colors.gold }]}
        size={size}
        strokeWidth={strokeWidth}
        total={revenue}
      />
      <Text className="mt-2 text-base font-bold text-lucrei-text">{formatBRL(revenue)}</Text>
      <Text className="text-[10px] text-lucrei-textMuted">faturamento</Text>
    </View>
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

  // Com faturamento mas nenhuma categoria preenchida (loja sem produto
  // cadastrado ainda - profit null exclui a linha INTEIRA do cálculo, não
  // só o lucro, ver summary/routes.ts) o anel ficaria "sumido" sem
  // explicação. Mostra uma rosca cinza neutra em vez de desaparecer.
  if (visible.length === 0) {
    if (summary.revenue <= 0) return null;
    return (
      <View className="items-center">
        <DonutRing segments={[{ label: 'Sem dado', value: 1, color: Colors.border }]} size={size} strokeWidth={strokeWidth} total={1} />
        {legend && (
          <Text className="mt-3 max-w-[140px] text-center text-xs text-lucrei-textMuted">
            Sem custo cadastrado pra calcular ainda
          </Text>
        )}
      </View>
    );
  }

  return (
    <View className="items-center">
      <DonutRing segments={segments} size={size} strokeWidth={strokeWidth} total={summary.revenue} />
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
