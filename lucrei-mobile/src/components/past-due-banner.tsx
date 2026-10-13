import { Text } from 'react-native';

import { GlassCard } from '@/components/glass-card';
import { useSubscriptionAccess } from '@/lib/subscription-access';
import { useColors } from '@/lib/theme';

// Reaproveitado em Início/Pedidos/Produtos/Relatórios - mesmo aviso, mesmo
// lugar (logo abaixo do cabeçalho da tela) em todo canto que borra valor por
// pagamento em atraso.
export function PastDueBanner() {
  const Colors = useColors();
  const { isPastDue, blocked, graceDaysLeft } = useSubscriptionAccess();
  if (!isPastDue) return null;

  return (
    <GlassCard className="mt-4 p-4" borderRadius={16}>
      <Text className="text-xs font-medium text-lucrei-textMuted">Pagamento pendente</Text>
      <Text className="mt-1 text-xs" style={{ color: Colors.danger }}>
        {blocked
          ? 'Prazo de carência esgotado — a sincronização parou até você regularizar o pagamento.'
          : `Valores ocultos até regularizar. Você tem ${graceDaysLeft} ${graceDaysLeft === 1 ? 'dia' : 'dias'} de carência antes da sincronização travar.`}
      </Text>
    </GlassCard>
  );
}
