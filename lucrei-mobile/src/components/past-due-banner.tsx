import { Text, View } from 'react-native';

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
    <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
      <Text className="text-xs font-medium text-lucrei-textMuted">Pagamento pendente</Text>
      <Text className="mt-1 text-xs" style={{ color: Colors.danger }}>
        {blocked
          ? 'Prazo de carência esgotado — a sincronização parou até você regularizar o pagamento.'
          : `Valores ocultos até regularizar. Você tem ${graceDaysLeft} ${graceDaysLeft === 1 ? 'dia' : 'dias'} de carência antes da sincronização travar.`}
      </Text>
    </View>
  );
}
