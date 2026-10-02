import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MarketplaceBadge } from '@/components/marketplace-badge';
import { Screen } from '@/components/screen';
import { ToastBanner, useToast } from '@/components/toast';
import { ShopTaxRateField } from '@/components/shop-tax-rate-field';
import { API_URL, disconnectShop, getDailyGoalSuggestion, type AuthUser, type Shop } from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { fullscreenOverlayStyle, useIsDesktopWeb, useModalPresentation, webCapWidth } from '@/lib/responsive';
import { useSelectedShop } from '@/lib/selected-shop';
import { useAppTheme, useColors, type ThemePreference } from '@/lib/theme';

const SUPPORT_EMAIL = 'suporte@lucreiapp.com';
// Formato wa.me: código do país (55) + DDD + número, só dígitos.
const SUPPORT_WHATSAPP = '5511968575255';

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
  const { state } = useAuth();
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  function openWhatsApp() {
    const email = state.status === 'authenticated' ? state.user.email : '';
    // E-mail da conta já vai na mensagem pra identificar quem é na hora, sem
    // precisar perguntar - mesma ideia que já valeu pra pergunta sobre o
    // link de WhatsApp lá atrás.
    const text = `Olá! Preciso de ajuda no Lucrei.${email ? ` Minha conta: ${email}` : ''}`;
    Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(text)}`);
  }

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
        onPress={openWhatsApp}
        className="mt-5 flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-gold py-3">
        <Ionicons name="logo-whatsapp" size={16} color={Colors.onGold} />
        <Text className="text-sm font-semibold text-lucrei-onGold">Falar no WhatsApp</Text>
      </Pressable>
      <Pressable
        onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        className="mt-2.5 flex-row items-center justify-center gap-2 rounded-xl border border-lucrei-border py-3">
        <Ionicons name="mail-outline" size={16} color={Colors.textMuted} />
        <Text className="text-sm font-medium text-lucrei-textMuted">Ou por e-mail</Text>
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

type MenuKey = 'name' | 'password' | 'shops' | 'dailyGoal' | 'help' | 'deleteAccount' | null;

function PlanSection({ user }: { user: AuthUser }) {
  const router = useRouter();
  const { cancelPlan } = useAuth();
  const Colors = useColors();
  const [canceling, setCanceling] = useState(false);

  const isCanceled = user.subscriptionStatus === 'canceled';
  const isTrialing = user.subscriptionStatus === 'trialing';

  function confirmCancel() {
    // Cancelar durante o teste é diferente de cancelar um plano pago: o
    // teste é só uma vez por loja pra sempre (regra pra impedir reiniciar
    // teste trocando de conta), então encerrar cedo é uma decisão
    // permanente sem nenhum benefício - a mensagem genérica de "pode
    // assinar de novo quando quiser" escondia isso.
    showAlert(
      isTrialing ? 'Encerrar o teste grátis?' : 'Cancelar plano?',
      isTrialing
        ? 'Você perde o acesso na hora, antes do fim previsto do teste. Como o teste grátis vale só uma vez por loja, depois de encerrado você não pode testar de novo - só assinar direto.'
        : 'Você perde acesso aos recursos do plano ao final do período atual. Você pode assinar novamente quando quiser.',
      [
        { text: 'Voltar', style: 'cancel' },
        { text: isTrialing ? 'Encerrar teste' : 'Cancelar plano', style: 'destructive', onPress: handleCancel },
      ]
    );
  }

  async function handleCancel() {
    setCanceling(true);
    const result = await cancelPlan();
    setCanceling(false);
    if (!result.ok) {
      showAlert('Erro', result.message);
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
              <Text className="text-sm font-semibold text-lucrei-danger">
                {isTrialing ? 'Encerrar teste' : 'Cancelar plano'}
              </Text>
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
  desktopMaxWidth,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  // Sobrepõe a largura padrão (480px) no desktop web - "Lojas conectadas"
  // cresce em lista (mais lojas, mais marketplaces) e ficava apertada
  // demais nessa largura fixa pensada pra formulários curtos (nome, senha).
  desktopMaxWidth?: number;
}) {
  const Colors = useColors();
  const modal = useModalPresentation();
  const panelWidthStyle =
    modal.isDesktop && desktopMaxWidth ? { ...modal.panelWidthStyle, maxWidth: desktopMaxWidth } : modal.panelWidthStyle;

  // Um <Modal> nativo é uma janela Android separada que não participa do
  // resize da Activity quando o teclado abre - por isso KeyboardAvoidingView
  // não tinha efeito nenhum aqui dentro. Renderiza como overlay normal na
  // própria árvore da tela em vez disso, herdando o resize nativo que já
  // funciona no resto do app.
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <View style={fullscreenOverlayStyle} className={`${modal.overlayClassName} ${modal.overlayBgClassName}`}>
      {/* No desktop web, o overlay centraliza com "items-center justify-center" -
          sem largura própria aqui, o KeyboardAvoidingView (um View comum na
          web) encolhia pro conteúdo mínimo ANTES do SafeAreaView de dentro
          conseguir aplicar "width: 100%" (100% de uma caixa já encolhida,
          não da tela) - por isso os modais de formulário curto (nome, senha)
          apareciam bem mais estreitos que os 480px esperados, com campo
          cortado e scroll interno desnecessário. */}
      <KeyboardAvoidingView behavior="padding" style={panelWidthStyle}>
        <SafeAreaView edges={['bottom']} style={{ maxHeight: '85%', ...panelWidthStyle }} className={`${modal.panelClassName} bg-lucrei-bg`}>
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
      </KeyboardAvoidingView>
    </View>
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

// Formata com vírgula (padrão BR) só pra exibir/editar - a comparação e o
// envio pro backend usam Number com ponto (ver handleSave).
function formatGoalInput(value: number) {
  return value.toFixed(2).replace('.', ',');
}

function DailyGoalField() {
  const { state, updateDailyGoal } = useAuth();
  const Colors = useColors();
  const currentGoal = state.status === 'authenticated' ? state.user.dailyProfitGoal : null;
  const [goal, setGoal] = useState(currentGoal != null ? formatGoalInput(currentGoal) : '');
  const [saving, setSaving] = useState(false);
  const [loadingSuggestion, setLoadingSuggestion] = useState(currentGoal == null);
  const { toast, opacity, show } = useToast();

  // Só busca sugestão se a pessoa nunca configurou uma meta - uma meta já
  // definida não deve ser sobrescrita por um palpite calculado.
  useEffect(() => {
    if (currentGoal != null || state.status !== 'authenticated') return;
    let cancelled = false;
    getDailyGoalSuggestion(state.token)
      .then(({ suggestion }) => {
        if (!cancelled && suggestion > 0) setGoal(formatGoalInput(suggestion));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingSuggestion(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const parsed = goal.trim() === '' ? null : Number(goal.replace(',', '.'));
  const invalid = parsed !== null && (Number.isNaN(parsed) || parsed < 0);
  const dirty = !invalid && parsed !== currentGoal;

  async function handleSave() {
    setSaving(true);
    const result = await updateDailyGoal(parsed);
    setSaving(false);
    if (result.ok) {
      show({ title: 'Meta salva', message: 'Sua meta diária de lucro foi atualizada.', tone: 'success' });
    } else {
      show({ title: 'Não foi possível salvar', message: result.message, tone: 'error' });
    }
  }

  return (
    <View>
      <ToastBanner toast={toast} opacity={opacity} />
      <Text className="mb-3 text-sm leading-5 text-lucrei-textMuted">
        Quando o lucro do dia (somando todas as suas lojas) bater esse valor, você recebe uma notificação. Deixe em
        branco pra desligar.
      </Text>
      <Text className="mb-1.5 text-xs text-lucrei-textMuted">Meta diária de lucro (R$)</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={goal}
          onChangeText={setGoal}
          placeholder={loadingSuggestion ? 'Calculando sugestão...' : '0,00'}
          placeholderTextColor={Colors.textMuted}
          keyboardType="decimal-pad"
          editable={!loadingSuggestion}
          className="flex-1 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
        />
        <Pressable
          onPress={handleSave}
          disabled={!dirty || saving || loadingSuggestion}
          className="h-11 w-11 items-center justify-center rounded-xl bg-lucrei-gold"
          style={{ opacity: !dirty || saving || loadingSuggestion ? 0.4 : 1 }}>
          {saving ? (
            <ActivityIndicator size="small" color={Colors.onGold} />
          ) : (
            <Ionicons name="checkmark" size={18} color={Colors.onGold} />
          )}
        </Pressable>
      </View>
      {invalid && <Text className="mt-2 text-xs text-lucrei-danger">Digite um valor válido ou deixe em branco.</Text>}
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
  // Conta criada via Google sem senha de verdade nunca definida - não tem
  // "senha atual" pra pedir aqui (ver User.hasPassword no backend).
  const needsCurrentPassword = state.status === 'authenticated' ? state.user.hasPassword : true;

  const canSave =
    (!needsCurrentPassword || currentPassword.length > 0) && newPassword.length >= 6 && newPassword === confirmPassword;

  async function handleSave() {
    if (state.status !== 'authenticated') return;
    if (newPassword !== confirmPassword) {
      show({ title: 'Senhas não conferem', message: 'A nova senha e a confirmação precisam ser iguais.', tone: 'error' });
      return;
    }
    setSaving(true);
    const result = await changePassword(needsCurrentPassword ? currentPassword : undefined, newPassword);
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
      {needsCurrentPassword ? (
        <TextInput
          value={currentPassword}
          onChangeText={setCurrentPassword}
          placeholder="Senha atual"
          placeholderTextColor={Colors.textMuted}
          secureTextEntry
          className="mb-2.5 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
        />
      ) : (
        <Text className="mb-2.5 text-xs text-lucrei-textMuted">
          Sua conta usa login com Google e ainda não tem senha - defina uma abaixo.
        </Text>
      )}
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
    showAlert(
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
      showAlert('Erro', 'Não foi possível desconectar a loja agora.');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <View className="rounded-xl border border-lucrei-border bg-lucrei-surface p-3.5">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 flex-row items-center gap-2.5">
          <MarketplaceBadge provider={shop.provider} size={24} />
          <View className="flex-1">
            <Text className="text-sm text-lucrei-text" numberOfLines={1}>
              {shop.shopName}
            </Text>
            <Text className="text-[11px] text-lucrei-textMuted">
              {shop.provider === 'mercado_livre' ? 'Mercado Livre' : 'Shopee'}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center gap-3">
          <View
            className="rounded-full px-2 py-0.5"
            style={{ backgroundColor: active ? Colors.gold : Colors.surfaceAlt }}>
            <Text className="text-[10px] font-medium" style={{ color: active ? Colors.onGold : Colors.textMuted }}>
              {active ? 'Ativa' : 'Desconectada'}
            </Text>
          </View>
          {active && (
            <Pressable onPress={confirmDisconnect} disabled={disconnecting} hitSlop={8}>
              {disconnecting ? (
                <ActivityIndicator size="small" color={Colors.danger} />
              ) : (
                <Text className="text-xs font-medium text-lucrei-danger">Desconectar</Text>
              )}
            </Pressable>
          )}
        </View>
      </View>

      {!active && (
        <Text className="mt-2 text-xs text-lucrei-textMuted">
          Desconectada em {shop.disconnectedAt ? dateFormatter.format(new Date(shop.disconnectedAt)) : '—'}. Seus
          dados ficam guardados — conecte de novo na tela Início quando quiser.
        </Text>
      )}

      {active && <ShopTaxRateField shop={shop} />}
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
  const { state, deleteAccount } = useAuth();
  const Colors = useColors();
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const { toast, opacity, show } = useToast();
  // Conta criada via Google sem senha de verdade nunca definida - não tem
  // "senha atual" pra pedir aqui (ver User.hasPassword no backend).
  const needsPassword = state.status === 'authenticated' ? state.user.hasPassword : true;

  function confirmDelete() {
    showAlert(
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
    const result = await deleteAccount(needsPassword ? password : undefined);
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
      {needsPassword && (
        <>
          <Text className="mb-1.5 text-xs text-lucrei-textMuted">Confirme sua senha</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Sua senha"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry
            className="mb-4 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
          />
        </>
      )}
      <Pressable
        onPress={confirmDelete}
        disabled={(needsPassword && password.length === 0) || deleting}
        className="items-center rounded-xl bg-lucrei-danger py-3"
        style={{ opacity: (needsPassword && password.length === 0) || deleting ? 0.4 : 1 }}>
        {deleting ? <ActivityIndicator size="small" color="#FFFFFF" /> : (
          <Text className="text-sm font-semibold text-white">Excluir conta permanentemente</Text>
        )}
      </Pressable>
    </View>
  );
}

const APPEARANCE_OPTIONS: { key: ThemePreference; label: string }[] = [
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
  const isDesktop = useIsDesktopWeb();

  return (
    <>
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
        <MenuRow icon="trophy-outline" label="Meta diária de lucro" onPress={() => setOpenMenu('dailyGoal')} />
        <MenuRow icon="help-circle-outline" label="Ajuda" onPress={() => setOpenMenu('help')} />
        <MenuRow icon="document-text-outline" label="Termos de uso" onPress={() => Linking.openURL(`${API_URL}/termos`)} />
        <MenuRow icon="shield-checkmark-outline" label="Política de privacidade" onPress={() => Linking.openURL(`${API_URL}/privacidade`)} />

        {/* No desktop largo, sair da conta já mora fixo no rodapé do menu
            lateral - manter aqui também seria duplicado. */}
        {!isDesktop && (
          <Pressable
            onPress={logout}
            className="mt-6 items-center rounded-2xl border border-lucrei-border py-4">
            <Text className="text-base font-semibold text-lucrei-danger">Sair da conta</Text>
          </Pressable>
        )}

        <Pressable onPress={() => setOpenMenu('deleteAccount')} className={`${isDesktop ? 'mt-6' : 'mt-4'} items-center py-2`}>
          <Text className="text-xs font-medium text-lucrei-danger">Excluir conta</Text>
        </Pressable>
      </ScrollView>
      </Screen>

      <SettingsModal title="Alterar nome" visible={openMenu === 'name'} onClose={() => setOpenMenu(null)}>
        <NameField />
      </SettingsModal>

      <SettingsModal title="Alterar senha" visible={openMenu === 'password'} onClose={() => setOpenMenu(null)}>
        <PasswordSection />
      </SettingsModal>

      <SettingsModal
        title="Lojas conectadas"
        visible={openMenu === 'shops'}
        onClose={() => setOpenMenu(null)}
        desktopMaxWidth={640}>
        <ShopsList />
      </SettingsModal>

      <SettingsModal title="Meta diária de lucro" visible={openMenu === 'dailyGoal'} onClose={() => setOpenMenu(null)}>
        <DailyGoalField />
      </SettingsModal>

      <SettingsModal title="Ajuda" visible={openMenu === 'help'} onClose={() => setOpenMenu(null)}>
        <HelpSection />
      </SettingsModal>

      <SettingsModal title="Excluir conta" visible={openMenu === 'deleteAccount'} onClose={() => setOpenMenu(null)}>
        <DeleteAccountSection />
      </SettingsModal>
    </>
  );
}
