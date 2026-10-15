import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { GlassCard } from '@/components/glass-card';
import { Screen } from '@/components/screen';
import {
  getCheckoutUrl,
  getPlans,
  validateCoupon,
  ApiError,
  type BillingPeriod,
  type CouponPreview,
  type Plan,
} from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { webCapWidth } from '@/lib/responsive';
import { useColors } from '@/lib/theme';

type LoadState = 'loading' | 'ready' | 'error';

const SUPPORT_EMAIL = 'suporte@lucreiapp.com';

function formatSalesLimit(limit: number | null) {
  return limit === null ? 'Sob consulta' : `${limit.toLocaleString('pt-BR')}/mês`;
}

function formatIntegrationsLimit(limit: number | null) {
  if (limit === null) return 'Ilimitadas';
  return limit === 1 ? '1 integração' : `${limit} integrações`;
}

// No navegador, window.open() só é aceito sem bloqueio de pop-up quando
// chamado DIRETO dentro do gesto de clique - uma chamada de rede no meio
// (criar o link de pagamento na HyperCash) é o suficiente pra passar da
// janela que o navegador aceita como "ainda é o clique do usuário", e o
// pop-up é bloqueado silenciosamente (reportado ao vivo: funcionava em
// "Ver fatura", que só lê do nosso banco, mas não em "Assinar", que espera
// a HyperCash responder). Abre uma aba em branco JÁ no clique (ainda síncrono,
// sem bloqueio) e só troca a URL dela depois que o link estiver pronto.
// Fica em branco por alguns segundos (tempo da HyperCash criar o link) sem
// isso - parece que travou/quebrou. Uma tela de carregamento simples (sem
// depender de nenhum bundle, é HTML puro escrito direto na aba nova) deixa
// claro que algo está acontecendo.
const PENDING_TAB_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Lucrei</title>
<style>
  body { margin:0; height:100vh; display:flex; align-items:center; justify-content:center; flex-direction:column; gap:16px; background:#0A0A0B; font-family:system-ui,-apple-system,sans-serif; }
  .spinner { width:32px; height:32px; border:3px solid rgba(245,197,24,0.25); border-top-color:#F5C518; border-radius:50%; animation:spin 0.8s linear infinite; }
  p { color:#9B9BA1; font-size:14px; }
  @keyframes spin { to { transform:rotate(360deg); } }
</style></head>
<body><div class="spinner"></div><p>Preparando pagamento…</p></body></html>`;

function openPendingTab(): Window | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    const tab = window.open('', '_blank');
    tab?.document.write(PENDING_TAB_HTML);
    return tab;
  } catch {
    return null;
  }
}

function resolvePendingTab(pendingTab: Window | null, url: string | null) {
  if (!url) {
    pendingTab?.close();
    return;
  }
  if (pendingTab && !pendingTab.closed) {
    pendingTab.location.href = url;
  } else {
    WebBrowser.openBrowserAsync(url);
  }
}

function PlanCard({ plan, appliedCoupon }: { plan: Plan; appliedCoupon: CouponPreview | null }) {
  const { state, selectPlan } = useAuth();
  const Colors = useColors();
  const [saving, setSaving] = useState(false);
  const [checkingInvoice, setCheckingInvoice] = useState(false);
  const user = state.status === 'authenticated' ? state.user : null;
  const effectivePercentOff = appliedCoupon?.percentOff ?? user?.pendingCouponPercentOff ?? null;
  const isCustomPricing = plan.priceCurrent === null;

  const isCurrent = user?.plan?.key === plan.key && user.subscriptionStatus !== 'canceled';
  // Quem está em teste grátis no plano atual pode decidir pagar antes do
  // prazo acabar - pedido ao vivo: "o cliente tem que poder sair do teste
  // de graça por conta própria". O backend só encerra o teste de verdade
  // quando o pagamento confirma (não quando clica), então mantém os botões
  // ativos aqui também - só trava quando já é pagamento de verdade
  // (active/past_due) no plano atual, que aí não tem o que fazer.
  const isCurrentAndTrialing = isCurrent && user?.subscriptionStatus === 'trialing';
  const actionLabel = isCurrentAndTrialing
    ? 'Pagar agora e sair do teste grátis'
    : isCurrent
      ? 'Plano atual'
      : user?.plan?.key === plan.key
        ? 'Reativar plano'
        : user?.plan
          ? 'Fazer upgrade'
          : plan.trialEligible
            ? 'Testar 15 dias grátis'
            : 'Assinar agora';

  async function doSubscribe() {
    const pendingTab = openPendingTab();
    setSaving(true);
    const result = await selectPlan(plan.key, appliedCoupon?.code);
    setSaving(false);
    if (result.ok) {
      // checkoutUrl presente = tem cobrança de verdade acontecendo agora
      // (assinatura nova sem teste, ou pagando pra sair do teste antes do
      // prazo) - "teste grátis começou" só é verdade quando NENHUM link de
      // pagamento foi gerado. Antes isso olhava pro trialEndsAt, que
      // continua preenchido mesmo pagando (status só vira 'active' depois
      // do webhook confirmar), e mostrava a mensagem errada pra quem
      // estava saindo do teste pra pagar.
      showAlert(
        'Plano atualizado',
        result.checkoutUrl
          ? `Abrindo o checkout pra confirmar o pagamento do plano ${plan.name}.`
          : result.trialEndsAt
            ? `Você agora está no plano ${plan.name}. Seu teste grátis de 15 dias começou.`
            : `Você agora está no plano ${plan.name}.`
      );
      resolvePendingTab(pendingTab, result.checkoutUrl);
    } else {
      pendingTab?.close();
      showAlert('Não foi possível assinar', result.message);
    }
  }

  function handlePressSubscribe() {
    // Trocar de plano no MEIO de um teste grátis encerra ele na hora (o
    // plano novo não é elegível a teste - só o Start é) e já manda cobrar -
    // reportado ao vivo: clicar em "Fazer upgrade" só pra ver o preço
    // encerrava o teste sem aviso nenhum. Confirma antes nesse caso
    // específico; nos outros (assinar pela 1ª vez, pagar o próprio plano
    // atual pra sair do teste, trocar entre planos já pagos) segue direto,
    // sem perguntar de novo.
    const wouldEndTrial = user?.subscriptionStatus === 'trialing' && user?.plan?.key !== plan.key;
    if (wouldEndTrial) {
      showAlert(
        'Encerrar teste grátis?',
        `Você ainda está no período de teste grátis do plano ${user?.plan?.name}. Trocar para o plano ${plan.name} encerra esse teste agora e já vai pedir o pagamento.`,
        [
          { text: 'Voltar', style: 'cancel' },
          { text: 'Encerrar e pagar', style: 'destructive', onPress: doSubscribe },
        ]
      );
      return;
    }
    doSubscribe();
  }

  async function handleViewInvoice() {
    if (state.status !== 'authenticated') return;
    const pendingTab = openPendingTab();
    setCheckingInvoice(true);
    try {
      const { checkoutUrl } = await getCheckoutUrl(state.token);
      if (checkoutUrl) {
        resolvePendingTab(pendingTab, checkoutUrl);
        return;
      }
      pendingTab?.close();
      showAlert('Nenhuma fatura', 'Não encontramos uma fatura em aberto para esse plano.');
    } finally {
      setCheckingInvoice(false);
    }
  }

  const showInvoiceLink = isCurrent && (user?.subscriptionStatus === 'trialing' || user?.subscriptionStatus === 'past_due');

  return (
    <GlassCard className="mt-3 p-5" borderRadius={16}>
      <Text className="text-xs font-semibold uppercase tracking-wide text-lucrei-gold">Plano {plan.name}</Text>

      {isCustomPricing ? (
        <Text className="mt-2 text-2xl font-bold text-lucrei-text">Sob consulta</Text>
      ) : (
        <>
          {/* Com cupom aplicado, o preço corrente entra riscado igual o
              priceOriginal já fazia pra promoção do próprio plano - pedido
              ao vivo: antes o desconto só aparecia numa legenda solta
              embaixo, sem cortar o R$ 97,00 original. Mesma conta de
              centavos do backend (applyPercentOff), pra nunca mostrar um
              valor diferente do que a cobrança Pix vai gerar de verdade.
              effectivePercentOff cobre dois casos: cupom digitado agora
              (appliedCoupon) OU um desconto que já ficou preso numa
              assinatura de uma tentativa anterior (user.pendingCouponPercentOff)
              - sem isso, reaplicar o mesmo código dava erro "já usado" e a
              tela nunca mostrava que o desconto, na real, já estava valendo. */}
          <View className="mt-2 flex-row flex-wrap items-baseline gap-2">
            {plan.priceOriginal !== null && (
              <Text className="text-sm text-lucrei-textMuted line-through">{formatBRL(plan.priceOriginal)}</Text>
            )}
            <Text
              className="text-2xl font-bold text-lucrei-text"
              style={effectivePercentOff !== null ? { textDecorationLine: 'line-through', opacity: 0.5 } : undefined}>
              {formatBRL(plan.priceCurrent!)}
            </Text>
            {effectivePercentOff !== null && (
              <Text className="text-2xl font-bold" style={{ color: Colors.gold }}>
                {formatBRL(Math.round(plan.priceCurrent! * (1 - effectivePercentOff / 100) * 100) / 100)}
              </Text>
            )}
            <Text className="text-sm text-lucrei-textMuted">{plan.billingPeriod === 'annual' ? '/ano' : '/mês'}</Text>
          </View>
          {plan.billingPeriod === 'annual' && (
            <Text className="mt-0.5 text-xs text-lucrei-textMuted">
              equivale a {formatBRL(plan.priceCurrent! / 12)}/mês
            </Text>
          )}
          {effectivePercentOff !== null && (
            <View className="mt-1.5 flex-row items-center gap-1.5">
              <Ionicons name="pricetag" size={12} color={Colors.gold} />
              <Text className="text-xs text-lucrei-textMuted">
                {appliedCoupon ? (
                  <>
                    cupom <Text style={{ fontWeight: '700', color: Colors.gold }}>{appliedCoupon.code}</Text> —{' '}
                  </>
                ) : null}
                {effectivePercentOff}% off em todas as cobranças
              </Text>
            </View>
          )}
        </>
      )}

      <View className="mt-4 gap-2">
        <View className="flex-row items-center gap-2">
          <Ionicons name="checkmark-circle" size={16} color={Colors.gold} />
          <Text className="text-sm text-lucrei-text">Vendas – {formatSalesLimit(plan.salesLimit)}</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Ionicons name="checkmark-circle" size={16} color={Colors.gold} />
          <Text className="text-sm text-lucrei-text">
            Integrações – {formatIntegrationsLimit(plan.integrationsLimit)}
          </Text>
        </View>
      </View>

      {isCustomPricing ? (
        <Pressable
          onPress={() =>
            Linking.openURL(
              `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Interesse no plano ${plan.name}`)}`
            )
          }
          className="mt-5 items-center rounded-xl bg-lucrei-gold py-3">
          <Text className="text-sm font-semibold text-lucrei-onGold">Falar com vendas</Text>
        </Pressable>
      ) : (
        <View className="mt-5">
          <Pressable
            onPress={handlePressSubscribe}
            disabled={(isCurrent && !isCurrentAndTrialing) || saving}
            className="flex-row items-center justify-center gap-1.5 rounded-xl bg-lucrei-gold py-3"
            style={{ opacity: isCurrent && !isCurrentAndTrialing ? 0.5 : saving ? 0.7 : 1 }}>
            {saving ? (
              <ActivityIndicator size="small" color={Colors.onGold} />
            ) : (
              <Text className="text-sm font-semibold text-lucrei-onGold">{actionLabel}</Text>
            )}
          </Pressable>
        </View>
      )}

      {!isCustomPricing && (
        <Text className="mt-3 text-[11px] leading-4 text-lucrei-textMuted">
          {plan.billingPeriod === 'annual'
            ? '*a cobrança se repete todo ano até você cancelar.'
            : '*a cobrança se repete todo mês até você cancelar.'}
        </Text>
      )}

      {showInvoiceLink && (
        <Pressable onPress={handleViewInvoice} disabled={checkingInvoice} className="mt-3 items-center">
          {checkingInvoice ? (
            <ActivityIndicator size="small" color={Colors.gold} />
          ) : (
            <Text className="text-xs font-medium text-lucrei-gold">
              {user?.subscriptionStatus === 'past_due' ? 'Pagamento pendente — ver fatura' : 'Ver fatura / configurar pagamento'}
            </Text>
          )}
        </Pressable>
      )}
    </GlassCard>
  );
}

const BILLING_PERIOD_OPTIONS: { key: BillingPeriod; label: string }[] = [
  { key: 'monthly', label: 'Mensal' },
  { key: 'annual', label: 'Anual' },
];

export default function PlanosScreen() {
  const router = useRouter();
  const Colors = useColors();
  const { state: authState } = useAuth();
  // Variável à parte só pra TS conseguir estreitar o tipo dentro do JSX
  // abaixo (o narrowing de "authState.status === 'authenticated'" não
  // atravessa a condição composta com || mais embaixo).
  const pendingCouponPercentOff = authState.status === 'authenticated' ? authState.user.pendingCouponPercentOff : null;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [plans, setPlans] = useState<Plan[]>([]);
  // Se a pessoa já tem um plano, abre o seletor já no período que ela paga
  // hoje - evita ela ver preço mensal por engano estando no anual (ou vice-versa).
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(
    authState.status === 'authenticated' ? (authState.user.plan?.billingPeriod ?? 'monthly') : 'monthly'
  );
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<CouponPreview | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checkingCoupon, setCheckingCoupon] = useState(false);

  async function handleApplyCoupon() {
    if (authState.status !== 'authenticated' || !couponInput.trim()) return;
    setCheckingCoupon(true);
    setCouponError(null);
    try {
      const preview = await validateCoupon(authState.token, couponInput.trim());
      setAppliedCoupon(preview);
    } catch (err) {
      setAppliedCoupon(null);
      setCouponError(err instanceof ApiError ? err.message : 'Não foi possível validar o cupom.');
    } finally {
      setCheckingCoupon(false);
    }
  }

  function handleClearCoupon() {
    setAppliedCoupon(null);
    setCouponError(null);
    setCouponInput('');
  }

  // Um "grupo" (Start, Pro, Master, Empresarial) tem uma linha de plano por
  // período de cobrança - mostra a que combina com o seletor, caindo pra
  // qualquer uma disponível no grupo se não existir a desse período
  // (Empresarial só tem a mensal, por exemplo).
  const visiblePlans = [...new Set(plans.map((p) => p.groupKey))]
    .map(
      (groupKey) =>
        plans.find((p) => p.groupKey === groupKey && p.billingPeriod === billingPeriod) ??
        plans.find((p) => p.groupKey === groupKey)
    )
    .filter((p): p is Plan => p !== undefined);

  useEffect(() => {
    let cancelled = false;
    getPlans()
      .then(({ plans }) => {
        if (cancelled) return;
        setPlans(plans);
        setLoadState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Screen>
      <View className="flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </Pressable>
        <Text className="text-2xl font-bold text-lucrei-text">Planos</Text>
      </View>
      <Text className="mt-2 text-base text-lucrei-textMuted">
        O plano Start inclui 15 dias grátis para testar. Escolha o plano ideal para o volume de vendas da sua loja.
      </Text>

      <View className="mt-5 flex-row rounded-2xl border border-lucrei-border bg-lucrei-surface p-1.5">
        {BILLING_PERIOD_OPTIONS.map((option) => {
          const active = option.key === billingPeriod;
          return (
            <Pressable
              key={option.key}
              onPress={() => setBillingPeriod(option.key)}
              className="flex-1 items-center rounded-xl py-2.5"
              style={{ backgroundColor: active ? Colors.gold : 'transparent' }}>
              <Text className="text-sm font-semibold" style={{ color: active ? Colors.onGold : Colors.text }}>
                {option.label}
              </Text>
              {option.key === 'annual' && (
                <Text
                  className="mt-0.5 text-[11px] font-medium"
                  style={{ color: active ? Colors.onGold : Colors.gold }}>
                  2 meses grátis
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* Reclamado ao vivo: com justify-between esticando pra preencher a
          largura inteira da coluna (até 1100px no desktop), um aviso de uma
          linha só virava uma barra enorme com um vão vazio gigante até o X
          no canto. alignSelf: flex-start + sem justify-between faz o card
          abraçar só o próprio conteúdo, igual um chip/toast. O estado do
          formulário (TextInput + botão Aplicar) continua largura cheia
          embaixo - esse sim precisa do espaço. */}
      {(appliedCoupon || pendingCouponPercentOff) && (
        <GlassCard className="mt-4 p-3.5" borderRadius={16} style={{ alignSelf: 'flex-start', maxWidth: '100%' }}>
          {appliedCoupon ? (
            <View className="flex-row items-center gap-2.5">
              <Ionicons name="pricetag" size={16} color={Colors.gold} />
              <Text className="text-sm text-lucrei-text">
                Cupom <Text style={{ fontWeight: '700' }}>{appliedCoupon.code}</Text> aplicado —{' '}
                <Text style={{ color: Colors.gold, fontWeight: '600' }}>{appliedCoupon.percentOff}% off</Text> em
                todas as cobranças.
              </Text>
              <Pressable onPress={handleClearCoupon} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
              </Pressable>
            </View>
          ) : (
            // Cupom já ficou preso numa assinatura de uma tentativa anterior
            // (ex: reabriu a tela depois de aplicar) - não tem "código" pra
            // mostrar aqui nem como desaplicar (não é mais um estado local,
            // já está salvo no servidor), só avisa que já está valendo.
            <View className="flex-row items-center gap-2">
              <Ionicons name="checkmark-circle" size={16} color={Colors.gold} />
              <Text className="text-sm text-lucrei-text">
                Você já tem um cupom aplicado —{' '}
                <Text style={{ color: Colors.gold, fontWeight: '600' }}>
                  {pendingCouponPercentOff}% off
                </Text>{' '}
                em todas as cobranças. Veja o valor em cada plano abaixo.
              </Text>
            </View>
          )}
        </GlassCard>
      )}

      {!appliedCoupon && !pendingCouponPercentOff && (
        <GlassCard className="mt-4 p-4" borderRadius={16}>
          <View className="flex-row items-center gap-2">
            <Ionicons name="pricetag-outline" size={16} color={Colors.textMuted} />
            <Text className="text-sm font-medium text-lucrei-text">Tem um cupom de desconto?</Text>
          </View>
          <View className="mt-2.5 flex-row gap-2">
            <TextInput
              value={couponInput}
              onChangeText={(v) => {
                setCouponInput(v.toUpperCase());
                setCouponError(null);
              }}
              placeholder="Código do cupom"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleApplyCoupon}
              className="flex-1 rounded-xl border border-lucrei-border bg-lucrei-bg px-3.5 py-2.5 text-sm text-lucrei-text"
            />
            <Pressable
              onPress={handleApplyCoupon}
              disabled={checkingCoupon || !couponInput.trim()}
              className="items-center justify-center rounded-xl bg-lucrei-surfaceAlt px-4"
              style={{ opacity: checkingCoupon || !couponInput.trim() ? 0.5 : 1 }}>
              {checkingCoupon ? (
                <ActivityIndicator size="small" color={Colors.gold} />
              ) : (
                <Text className="text-sm font-semibold text-lucrei-gold">Aplicar</Text>
              )}
            </Pressable>
          </View>
          {couponError && <Text className="mt-2 text-xs text-lucrei-danger">{couponError}</Text>}
          <Text className="mt-2 text-[11px] leading-4 text-lucrei-textMuted">
            O desconto vale em toda cobrança, por Pix ou cartão.
          </Text>
        </GlassCard>
      )}

      {loadState === 'loading' && (
        <View className="mt-10 items-center">
          <ActivityIndicator color={Colors.gold} />
        </View>
      )}

      {loadState === 'error' && (
        <View className="mt-10 items-center">
          <Text className="text-sm text-lucrei-danger">Não foi possível carregar os planos agora.</Text>
        </View>
      )}

      {loadState === 'ready' && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-8" contentContainerStyle={webCapWidth()}>
          {visiblePlans.map((plan) => (
            <PlanCard key={plan.key} plan={plan} appliedCoupon={appliedCoupon} />
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
