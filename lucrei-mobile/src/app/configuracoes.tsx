import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Screen } from '@/components/screen';
import { ToastBanner, useToast } from '@/components/toast';
import { Colors } from '@/constants/theme';
import { ApiError, changePassword as apiChangePassword, disconnectShop, type Shop } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSelectedShop } from '@/lib/selected-shop';

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

type MenuKey = 'name' | 'password' | 'shops' | null;

function SettingsModal({
  title,
  visible,
  onClose,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <SafeAreaView edges={['bottom']} style={{ maxHeight: '85%' }} className="rounded-t-3xl bg-lucrei-bg">
          <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
            <Text className="text-base font-semibold text-lucrei-text">{title}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView style={{ flexShrink: 1 }} contentContainerClassName="p-5">
            {children}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function MenuRow({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="mt-3 flex-row items-center gap-3 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
      <View className="h-9 w-9 items-center justify-center rounded-full bg-lucrei-surfaceAlt">
        <Ionicons name={icon} size={16} color={Colors.gold} />
      </View>
      <Text className="flex-1 text-sm font-medium text-lucrei-text">{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
    </Pressable>
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
          className="flex-1 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
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
        className="mb-2.5 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
      />
      <TextInput
        value={newPassword}
        onChangeText={setNewPassword}
        placeholder="Nova senha (mín. 6 caracteres)"
        placeholderTextColor={Colors.textMuted}
        secureTextEntry
        className="mb-2.5 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
      />
      <TextInput
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        placeholder="Confirmar nova senha"
        placeholderTextColor={Colors.textMuted}
        secureTextEntry
        className="mb-3 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
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
    <View className="rounded-xl border border-lucrei-border bg-lucrei-surface p-3.5">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 pr-2 text-sm text-lucrei-text" numberOfLines={1}>
          {shop.shopName}
        </Text>
        <View
          className="rounded-full px-2 py-0.5"
          style={{ backgroundColor: active ? Colors.gold : Colors.surfaceAlt }}>
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

function ShopsList() {
  const { shops, refresh } = useSelectedShop();
  return shops.length === 0 ? (
    <Text className="text-sm text-lucrei-textMuted">Nenhuma loja conectada ainda.</Text>
  ) : (
    <View className="gap-2.5">
      {shops.map((shop) => (
        <ShopRow key={shop.id} shop={shop} onDisconnected={refresh} />
      ))}
    </View>
  );
}

export default function ConfiguracoesScreen() {
  const { state, logout } = useAuth();
  const user = state.status === 'authenticated' ? state.user : null;
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);

  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Configurações</Text>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        Gerencie seu perfil, senha e lojas conectadas.
      </Text>

      {user && (
        <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
          <Text className="text-base font-semibold text-lucrei-text">{user.name}</Text>
          <Text className="mt-0.5 text-sm text-lucrei-textMuted">{user.email}</Text>
        </View>
      )}

      <MenuRow icon="person-outline" label="Alterar nome" onPress={() => setOpenMenu('name')} />
      <MenuRow icon="lock-closed-outline" label="Alterar senha" onPress={() => setOpenMenu('password')} />
      <MenuRow icon="storefront-outline" label="Lojas conectadas" onPress={() => setOpenMenu('shops')} />

      <Pressable
        onPress={logout}
        className="mt-6 items-center rounded-2xl border border-lucrei-border py-4">
        <Text className="text-base font-semibold text-lucrei-danger">Sair da conta</Text>
      </Pressable>

      <SettingsModal title="Alterar nome" visible={openMenu === 'name'} onClose={() => setOpenMenu(null)}>
        <NameField />
      </SettingsModal>

      <SettingsModal title="Alterar senha" visible={openMenu === 'password'} onClose={() => setOpenMenu(null)}>
        <PasswordSection />
      </SettingsModal>

      <SettingsModal title="Lojas conectadas" visible={openMenu === 'shops'} onClose={() => setOpenMenu(null)}>
        <ShopsList />
      </SettingsModal>
    </Screen>
  );
}
