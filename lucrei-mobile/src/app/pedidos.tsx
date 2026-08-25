import { Text } from 'react-native';

import { Screen } from '@/components/screen';

export default function PedidosScreen() {
  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Pedidos</Text>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        Seus pedidos da Shopee vão aparecer aqui, com o lucro de cada um.
      </Text>
    </Screen>
  );
}
