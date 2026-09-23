import { View } from 'react-native';

// Placeholder sólido no lugar de um valor financeiro escondido (pagamento em
// atraso, limite de vendas estourado) - reaproveitado em toda tela que
// mostra faturamento/lucro, em vez de cada uma reimplementar o próprio.
export function BlurredValue({ width, height = 14 }: { width: number; height?: number }) {
  return <View style={{ width, height, borderRadius: 4, opacity: 0.35 }} className="bg-lucrei-textMuted" />;
}
