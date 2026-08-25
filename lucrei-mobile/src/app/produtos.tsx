import { Text } from 'react-native';

import { Screen } from '@/components/screen';

export default function ProdutosScreen() {
  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Produtos</Text>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        Cadastre o custo dos seus produtos manualmente ou importe uma planilha.
      </Text>
    </Screen>
  );
}
