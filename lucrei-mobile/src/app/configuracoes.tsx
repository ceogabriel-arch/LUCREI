import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Screen } from '@/components/screen';
import { ToastBanner, useToast } from '@/components/toast';
import { API_URL, disconnectShop, type AuthUser, type Shop } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { webCapWidth } from '@/lib/responsive';
import { useSelectedShop } from '@/lib/selected-shop';
import { useAppTheme, useColors, type ThemePreference } from '@/lib/theme';

const SUPPORT_EMAIL = 'suporte@lucreiapp.com';

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: 'Como o Lucrei calcula meu lucro?',
    answer:
      'Pegamos o valor de repasse real da Shopee (depois de frete, comissão e taxas) e descontamos o custo do produto que você cadastrou. Pedidos sem custo cadastrado aparecem separados, sem entrar no total, pra não inflar o número.',
  },
  {
    question: 'Por que um pedido está sem lucro calculado?',
    answer:
      'Provavelmente o produto daquele pedido ainda não tem custo cadastrado. Cadastre o custo em Produtos e o pedido é recalculado automaticamente.',
  },
  {
    question: 'Posso conectar mais de uma loja Shopee?',
    answer: 'Sim. Em Início, toque em "Conectar outra loja" e escolha entre suas lojas pelo seletor no topo da tela.',
  },
  {
    question: 'Como funciona o teste grátis de 15 dias?',
    answer:
      'O plano Start inclui 15 dias grátis, um por loja Shopee. Depois do período de teste (ou se você já usou o teste com essa loja antes), a cobrança mensal começa a valer.',
  },
  {
    question: 'Como cancelo minha assinatura?',
    answer: 'Em Configurações, na seção do seu plano, toque em "Cancelar plano". Você mantém acesso até o fim do período já pago.',
  },
];

function HelpSection() {
  const Colors = useColors();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <View>
      <Text className="mb-4 text-sm leading-5 text-lucrei-textMuted">
        Dúvidas mais comuns. Se não encontrar o que precisa, fale direto com a gente.
      </Text>
      <View className="gap-2.5">
        {FAQ_ITEMS.map((item, index) => {
          const open = openFaq === index;
          return (
            <Pressable
              key={item.question}
              onPress={() => setOpenFaq(open ? null : index)}
              className="rounded-xl border border-lucrei-border bg-lucrei-surface p-4">
              <View className="flex-row items-center justify-between gap-2">
                <Text className="flex-1 text-sm font-medium text-lucrei-text">{item.question}</Text>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textMuted} />
              </View>
              {open && <Text className="mt-2 text-xs leading-5 text-lucrei-textMuted">{item.answer}</Text>}
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        className="mt-5 flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-gold py-3">
        <Ionicons name="mail-outline" size={16} color={Colors.onGold} />
        <Text className="text-sm font-semibold text-lucrei-onGold">Falar com o suporte</Text>
      </Pressable>
    </View>
  );
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const STATUS_LABEL: Record<AuthUser['subscriptionStatus'], string> = {
  trialing: 'Em teste',
  active: 'Ativo',
  past_due: 'Pagamento pendente',
  canceled: 'Cancelado',
};

type MenuKey = 'name' | 'password' | 'shops' | 'help' | 'deleteAccount' | null;

function PlanSection({ user }: { user: AuthUser }) {
  const router = useRouter();
  const { cancelPlan } = useAuth();
  const Colors = useColors();
  const [canceling, setCanceling] = useState(false);

  const isCanceled = user.subscriptionStatus === 'canceled';

  function confirmCancel() {
    Alert.alert(
      'Cancelar plano?',
      'Você perde acesso aos recursos do plano ao final do período atual. Você pode assinar novamente quando quiser.',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Cancelar plano', style: 'destructive', onPress: handleCancel },
      ]
    );
  }

  async function handleCancel() {
    setCanceling(true);
    const result = await cancelPlan();
    setCanceling(false);
    if (!result.ok) {
      Alert.alert('Erro', result.message);
    }
  }

  return (
    <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-base font-semibold text-lucrei-text">
          {user.plan ? `Plano ${user.plan.name}` : 'Nenhum plano ativo'}
        </Text>
        <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: Colors.surfaceAlt }}>
          <Text className="text-[10px] font-medium text-lucrei-textMuted">{STATUS_LABEL[user.subscriptionStatus]}</Text>
        </View>
      </View>

      {user.subscriptionStatus === 'trialing' && user.trialEndsAt && (
        <Text className="mt-1 text-xs text-lucrei-textMuted">
          Teste grátis até {dateFormatter.format(new Date(user.trialEndsAt))}
        </Text>
      )}

      <View className="mt-3 flex-row gap-2.5">
        <Pressable
          onPress={() => router.push('/planos')}
          className="flex-1 items-center rounded-xl bg-lucrei-gold py-2.5">
          <Text className="text-sm font-semibold text-lucrei-onGold">{user.plan ? 'Fazer upgrade' : 'Ver planos'}</Text>
        </Pressable>
        {user.plan && !isCanceled && (
          <Pressable
            onPress={confirmCancel}
            disabled={canceling}
            className="flex-1 items-center rounded-xl border border-lucrei-border py-2.5"
            style={{ opacity: canceling ? 0.5 : 1 }}>
            {canceling ? (
              <ActivityIndicator size="small" color={Colors.danger} />
            ) : (
              <Text className="text-sm font-semibold text-lucrei-danger">Cancelar plano</Text>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

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
  const Colors = useColors();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <SafeAreaView edges={['bottom']} style={{ maxHeight: '85%', ...webCapWidth() }} className="rounded-t-3xl bg-lucrei-bg">
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
  const Colors = useColors();
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
  const Colors = useColors();
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
          {saving ? (
            <ActivityIndicator size="small" color={Colors.onGold} />
          ) : (
            <Ionicons name="checkmark" size={18} color={Colors.onGold} />
          )}
        </Pressable>
      </View>
      {state.status === 'authenticated' && (
        <Text className="mt-3 text-xs text-lucrei-textMuted">{state.user.email}</Text>
      )}
    </View>
  );
}

function PasswordSection() {
  const { state, changePassword } = useAuth();
  const Colors = useColors();
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
    const result = await changePassword(currentPassword, newPassword);
    setSaving(false);
    if (result.ok) {
      show({ title: 'Senha alterada', message: 'Sua senha foi atualizada com sucesso.', tone: 'success' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } else {
      show({ title: 'Não foi possível trocar a senha', message: result.message, tone: 'error' });
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
          <ActivityIndicator size="small" color={Colors.onGold} />
        ) : (
          <Text className="text-sm font-semibold text-lucrei-onGold">Salvar nova senha</Text>
        )}
      </Pressable>
    </View>
  );
}

function ShopRow({ shop, onDisconnected }: { shop: Shop; onDisconnected: () => void }) {
  const { state } = useAuth();
  const Colors = useColors();
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
          <Text className="text-[10px] font-medium" style={{ color: active ? Colors.onGold : Colors.textMuted }}>
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

function DeleteAccountSection() {
  const { deleteAccount } = useAuth();
  const Colors = useColors();
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { toast, opacity, show } = useToast();

  function confirmDelete() {
    Alert.alert(
      'Excluir sua conta?',
      'Isso apaga permanentemente sua conta, lojas conectadas, pedidos e produtos. Não tem como desfazer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir permanentemente', style: 'destructive', onPress: handleDelete },
      ]
    );
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await deleteAccount(password);
    setDeleting(false);
    if (!result.ok) {
      show({ title: 'Não foi possível excluir', message: result.message, tone: 'error' });
    }
  }

  return (
    <View>
      <ToastBanner toast={toast} opacity={opacity} />
      <Text className="mb-4 text-sm leading-5 text-lucrei-textMuted">
        Essa ação é permanente. Todos os seus dados — lojas conectadas, pedidos, produtos e assinatura — serão
        apagados e não podem ser recuperados.
      </Text>
      <Text className="mb-1.5 text-xs text-lucrei-textMuted">Confirme sua senha</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Sua senha"
        placeholderTextColor={Colors.textMuted}
        secureTextEntry
        className="mb-4 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
      />
      <Pressable
        onPress={confirmDelete}
        disabled={password.length === 0 || deleting}
        className="items-center rounded-xl bg-lucrei-danger py-3"
        style={{ opacity: password.length === 0 || deleting ? 0.4 : 1 }}>
        {deleting ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
          <Text className="text-sm font-semibold text-white">Excluir conta permanentemente</Text>
        )}
      </Pressable>
    </View>
  );
}

const APPEARANCE_OPTIONS: { key: ThemePreference; label: string }[] = [
  { key: 'system', label: 'Sistema' },
  { key: 'light', label: 'Claro' },
  { key: 'dark', label: 'Escuro' },
];

function AppearanceSection() {
  const { preference, setPreference } = useAppTheme();
  const Colors = useColors();

  return (
    <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
      <View className="flex-row items-center gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-full bg-lucrei-surfaceAlt">
          <Ionicons name="contrast-outline" size={16} color={Colors.gold} />
        </View>
        <Text className="text-sm font-medium text-lucrei-text">Aparência</Text>
      </View>
      <View className="mt-3 flex-row self-start rounded-full bg-lucrei-surfaceAlt p-1">
        {APPEARANCE_OPTIONS.map((option) => {
          const active = option.key === preference;
          return (
            <Pressable
              key={option.key}
              onPress={() => setPreference(option.key)}
              className="rounded-full px-4 py-1.5"
              style={{ backgroundColor: active ? Colors.gold : 'transparent' }}>
              <Text className="text-xs font-medium" style={{ color: active ? Colors.onGold : Colors.textMuted }}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function ConfiguracoesScreen() {
  const { state, logout } = useAuth();
  const user = state.status === 'authenticated' ? state.user : null;
  const [openMenu, setOpenMenu] = useState<MenuKey>(null);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-8">
        <Text className="text-2xl font-bold text-lucrei-text">Configurações</Text>
        <Text className="mt-2 text-base text-lucrei-textMuted">
          Gerencie seu perfil, senha e lojas conectadas.
        </Text>

        <AppearanceSection />

        {user && (
          <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
            <Text className="text-base font-semibold text-lucrei-text">{user.name}</Text>
            <Text className="mt-0.5 text-sm text-lucrei-textMuted">{user.email}</Text>
          </View>
        )}

        {user && <PlanSection user={user} />}

        <MenuRow icon="person-outline" label="Alterar nome" onPress={() => setOpenMenu('name')} />
        <MenuRow icon="lock-closed-outline" label="Alterar senha" onPress={() => setOpenMenu('password')} />
        <MenuRow icon="storefront-outline" label="Lojas conectadas" onPress={() => setOpenMenu('shops')} />
        <MenuRow icon="help-circle-outline" label="Ajuda" onPress={() => setOpenMenu('help')} />
        <MenuRow icon="document-text-outline" label="Termos de uso" onPress={() => Linking.openURL(`${API_URL}/termos`)} />
        <MenuRow icon="shield-checkmark-outline" label="Política de privacidade" onPress={() => Linking.openURL(`${API_URL}/privacidade`)} />

        <Pressable
          onPress={logout}
          className="mt-6 items-center rounded-2xl border border-lucrei-border py-4">
          <Text className="text-base font-semibold text-lucrei-danger">Sair da conta</Text>
        </Pressable>

        <Pressable onPress={() => setOpenMenu('deleteAccount')} className="mt-4 items-center py-2">
          <Text className="text-xs font-medium text-lucrei-danger">Excluir conta</Text>
        </Pressable>
      </ScrollView>

      <SettingsModal title="Alterar nome" visible={openMenu === 'name'} onClose={() => setOpenMenu(null)}>
        <NameField />
      </SettingsModal>

      <SettingsModal title="Alterar senha" visible={openMenu === 'password'} onClose={() => setOpenMenu(null)}>
        <PasswordSection />
      </SettingsModal>

      <SettingsModal title="Lojas conectadas" visible={openMenu === 'shops'} onClose={() => setOpenMenu(null)}>
        <ShopsList />
      </SettingsModal>

      <SettingsModal title="Ajuda" visible={openMenu === 'help'} onClose={() => setOpenMenu(null)}>
        <HelpSection />
      </SettingsModal>

      <SettingsModal title="Excluir conta" visible={openMenu === 'deleteAccount'} onClose={() => setOpenMenu(null)}>
        <DeleteAccountSection />
      </SettingsModal>
    </Screen>
  );
}
