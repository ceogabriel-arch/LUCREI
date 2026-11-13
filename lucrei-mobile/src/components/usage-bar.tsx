import { Text, View } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import type { SalesUsage } from '@/lib/api';
import { useColors } from '@/lib/theme';

// Sem limite (salesLimit null) não mostra nada - não faz sentido uma barra
// de progresso pra um teto que não existe. Compartilhado entre Início,
// Relatórios e Pedidos - mesmo aviso em todo lugar que mostra lucro.
export function UsageBar({ usage }: { usage: SalesUsage }) {
  const Colors = useColors();
  if (usage.salesLimit == null) return null;

  const fraction = Math.min(1, usage.ordersThisMonth / usage.salesLimit);
  const nearLimit = !usage.overLimit && fraction >= 0.8;
  const barColor = usage.overLimit ? Colors.danger : nearLimit ? Colors.gold : Colors.success;

  return (
    <GlassCard className="mt-4 p-4" borderRadius={16}>
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-medium text-lucrei-textMuted">Vendas do mês</Text>
        <Text className="text-xs font-semibold" style={{ color: barColor }}>
          {usage.ordersThisMonth} / {usage.salesLimit}
        </Text>
      </View>
      <View className="mt-2 h-2 overflow-hidden rounded-full bg-lucrei-surfaceAlt">
        <View style={{ width: `${fraction * 100}%`, backgroundColor: barColor }} className="h-full rounded-full" />
      </View>
      {usage.blocked && (
        <Text className="mt-2 text-xs" style={{ color: Colors.danger }}>
          Limite atingido — novos pedidos não sincronizam mais até você fazer upgrade.
        </Text>
      )}
      {usage.overLimit && !usage.blocked && (
        <Text className="mt-2 text-xs" style={{ color: Colors.danger }}>
          Limite atingido — valores ocultos. Você tem {usage.graceDaysLeft}{' '}
          {usage.graceDaysLeft === 1 ? 'dia' : 'dias'} pra fazer upgrade antes da sincronização travar.
        </Text>
      )}
      {nearLimit && (
        <Text className="mt-2 text-xs text-lucrei-textMuted">Quase no limite do seu plano.</Text>
      )}
    </GlassCard>
  );
}
