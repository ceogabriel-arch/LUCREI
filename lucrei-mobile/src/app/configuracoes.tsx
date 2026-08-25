import { Pressable, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { useAuth } from '@/lib/auth';

export default function ConfiguracoesScreen() {
  const { state, logout } = useAuth();
  const user = state.status === 'authenticated' ? state.user : null;

  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Configurações</Text>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        Gerencie suas lojas conectadas e sua assinatura.
      </Text>

      {user ? (
        <View className="mt-6 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
          <Text className="text-base font-semibold text-lucrei-text">{user.name}</Text>
          <Text className="mt-0.5 text-sm text-lucrei-textMuted">{user.email}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={logout}
        className="mt-6 items-center rounded-2xl border border-lucrei-border py-4">
        <Text className="text-base font-semibold text-lucrei-danger">Sair da conta</Text>
      </Pressable>
    </Screen>
  );
}
