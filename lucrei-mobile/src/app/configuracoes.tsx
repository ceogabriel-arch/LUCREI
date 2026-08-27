import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Screen } from '@/components/screen';
import { ToastBanner, useToast } from '@/components/toast';
import { Colors } from '@/constants/theme';
import { ApiError, changePassword as apiChangePassword, disconnectShop, type Shop } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSelectedShop } from '@/lib/selected-shop';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
      <Text className="mb-3 text-sm font-semibold text-lucrei-text">{title}</Text>
      {children}
    </View>
  );
}

function NameField() {
  const { state, updateName } = useAuth();
  const currentName = state.status === 'authenticated' ? state.user.name : '';
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const { toast, opacity, show } = useToast();

  const dirty = name.trim() !== currentName && name.trim().length > 0;

  async function handleSave() {
    setSaving(true);
    const result = await updateName(name.trim());
    setSaving(false);
    if (result.ok) {
      show({ title: 'Nome atualizado', message: 'Seu nome foi salvo com sucesso.', tone: 'success' });
    } else {
      show({ title: 'Não foi possível salvar', message: result.message, tone: 'error' });
    }
  }

  return (
    <View>
      <ToastBanner toast={toast} opacity={opacity} />
      <Text className="mb-1.5 text-xs text-lucrei-textMuted">Nome</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={name}
          onChangeText={setName}
          className="flex-1 rounded-xl border border-lucrei-border bg-lucrei-bg px-4 py-3 text-sm text-lucrei-text"
        />
        <Pressable
          onPress={handleSave}
          disabled={!dirty || saving}
          className="h-11 w-11 items-center justify-center rounded-xl bg-lucrei-gold"
          style={{ opacity: !dirty || saving ? 0.4 : 1 }}>
          {saving ? <ActivityIndicator size="small" color={Colors.bg} /> : <Ionicons name="checkmark" size={18} color={Colors.bg} />}
        </Pressable>
      </View>
      {state.status === 'authenticated' && (
        <Text className="mt-3 text-xs text-lucrei-textMuted">{state.user.email}</Text>
      )}
    </View>
  );
}

function PasswordSection() {
  const { state } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast, opacity, show } = useToast();

  const canSave = currentPassword.length > 0 && newPassword.length >= 6 && newPassword === confirmPassword;

  async function handleSave() {
    if (state.status !== 'authenticated') return;
    if (newPassword !== confirmPassword) {
      show({ title: 'Senhas não conferem', message: 'A nova senha e a confirmação precisam ser iguais.', tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      await apiChangePassword(state.token, currentPassword, newPassword);
      show({ title: 'Senha alterada', message: 'Sua senha foi atualizada com sucesso.', tone: 'success' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      show({
        title: 'Não foi possível trocar a senha',
        message: err instanceof ApiError ? err.message : 'Tente novamente.',
        tone: 'error',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <ToastBanner toast={toast} opacity={opacity} />
      <TextInput
        value={currentPassword}
        onChangeText={setCurrentPassword}
        placeholder="Senha atual"
        placeholderTextColor={Colors.textMuted}
        secureTextEntry
        className="mb-2.5 rounded-xl border border-lucrei-border bg-lucrei-bg px-4 py-3 text-sm text-lucrei-text"
      />
      <TextInput
        value={newPassword}
        onChangeText={setNewPassword}
        placeholder="Nova senha (mín. 6 caracteres)"
        placeholderTextColor={Colors.textMuted}
        secureTextEntry
        className="mb-2.5 rounded-xl border border-lucrei-border bg-lucrei-bg px-4 py-3 text-sm text-lucrei-text"
      />
      <TextInput
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Confirmar nova senha"
        placeholderTextColor={Colors.textMuted}
        secureTextEntry
        className="mb-3 rounded-xl border border-lucrei-border bg-lucrei-bg px-4 py-3 text-sm text-lucrei-text"
      />
      <Pressable
        onPress={handleSave}
        disabled={!canSave || saving}
        className="items-center rounded-xl bg-lucrei-gold py-3"
        style={{ opacity: !canSave || saving ? 0.4 : 1 }}>
        {saving ? (
          <ActivityIndicator size="small" color={Colors.bg} />
        ) : (
          <Text className="text-sm font-semibold text-lucrei-bg">Salvar nova senha</Text>
        )}
      </Pressable>
    </View>
  );
}

function ShopRow({ shop, onDisconnected }: { shop: Shop; onDisconnected: () => void }) {
  const { state } = useAuth();
  const [disconnecting, setDisconnecting] = useState(false);
  const active = shop.status === 'active';

  function confirmDisconnect() {
    Alert.alert(
      'Desconectar loja?',
      `Você pode reconectar "${shop.shopName}" a qualquer momento. Seus pedidos e produtos ficam guardados.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Desconectar', style: 'destructive', onPress: handleDisconnect },
      ]
    );
  }

  async function handleDisconnect() {
    if (state.status !== 'authenticated') return;
    setDisconnecting(true);
    try {
      await disconnectShop(state.token, shop.id);
      onDisconnected();
    } catch {
      Alert.alert('Erro', 'Não foi possível desconectar a loja agora.');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <View className="rounded-xl border border-lucrei-border bg-lucrei-surfaceAlt p-3.5">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 pr-2 text-sm text-lucrei-text" numberOfLines={1}>
          {shop.shopName}
        </Text>
        <View
          className="rounded-full px-2 py-0.5"
          style={{ backgroundColor: active ? Colors.gold : Colors.surface }}>
          <Text className="text-[10px] font-medium" style={{ color: active ? Colors.bg : Colors.textMuted }}>
            {active ? 'Ativa' : 'Desconectada'}
          </Text>
        </View>
      </View>

      {active ? (
        <Pressable onPress={confirmDisconnect} disabled={disconnecting} className="mt-3 self-start">
          {disconnecting ? (
            <ActivityIndicator size="small" color={Colors.danger} />
          ) : (
            <Text className="text-xs font-medium text-lucrei-danger">Desconectar</Text>
          )}
        </Pressable>
      ) : (
        <Text className="mt-2 text-xs text-lucrei-textMuted">
          Desconectada em {shop.disconnectedAt ? dateFormatter.format(new Date(shop.disconnectedAt)) : '—'}. Seus
          dados ficam guardados — conecte de novo na tela Início quando quiser.
        </Text>
      )}
    </View>
  );
}

export default function ConfiguracoesScreen() {
  const { state, logout } = useAuth();
  const { shops, refresh } = useSelectedShop();
  const user = state.status === 'authenticated' ? state.user : null;

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-8">
        <Text className="text-2xl font-bold text-lucrei-text">Configurações</Text>
        <Text className="mt-2 text-base text-lucrei-textMuted">
          Gerencie seu perfil, senha e lojas conectadas.
        </Text>

        {user && (
          <SectionCard title="Perfil">
            <NameField />
          </SectionCard>
        )}

        <SectionCard title="Segurança">
          <PasswordSection />
        </SectionCard>

        <SectionCard title="Lojas conectadas">
          {shops.length === 0 ? (
            <Text className="text-sm text-lucrei-textMuted">Nenhuma loja conectada ainda.</Text>
          ) : (
            <View className="gap-2.5">
              {shops.map((shop) => (
                <ShopRow key={shop.id} shop={shop} onDisconnected={refresh} />
              ))}
            </View>
          )}
        </SectionCard>

        <Pressable
          onPress={logout}
          className="mt-6 items-center rounded-2xl border border-lucrei-border py-4">
          <Text className="text-base font-semibold text-lucrei-danger">Sair da conta</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
