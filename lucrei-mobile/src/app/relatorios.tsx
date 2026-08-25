import { Text } from 'react-native';

import { Screen } from '@/components/screen';

export default function RelatoriosScreen() {
  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Relatórios</Text>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        Acompanhe a evolução do seu lucro por período e por loja.
      </Text>
    </Screen>
  );
}
