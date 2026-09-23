import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { PixPaymentModal } from '@/components/pix-payment-modal';
import { Screen } from '@/components/screen';
import {
  getCheckoutUrl,
  getCurrentPixCharge,
  getPlans,
  validateCoupon,
  ApiError,
  type BillingPeriod,
  type CouponPreview,
  type Plan,
  type PixCharge,
} from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
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

function PlanCard({ plan, appliedCoupon }: { plan: Plan; appliedCoupon: CouponPreview | null }) {
  const { state, selectPlan, selectPlanPix } = useAuth();
  const Colors = useColors();
  const [savingMethod, setSavingMethod] = useState<'card' | 'pix' | null>(null);
  const [checkingInvoice, setCheckingInvoice] = useState(false);
  const [pixModal, setPixModal] = useState<PixCharge | null>(null);
  // Preenchido só quando o Pix aberto é um upgrade proporcional (o plano
  // ainda não mudou) - avisa o modal a checar isso em vez do status da
  // assinatura pra saber quando o pagamento confirmou.
  const [pixModalUpgradeTarget, setPixModalUpgradeTarget] = useState<string | null>(null);
  const user = state.status === 'authenticated' ? state.user : null;
  const isCustomPricing = plan.priceCurrent === null;

  const isCurrent = user?.plan?.key === plan.key && user.subscriptionStatus !== 'canceled';
  const actionLabel = isCurrent
    ? 'Plano atual'
    : user?.plan?.key === plan.key
      ? 'Reativar plano'
      : user?.plan
        ? 'Fazer upgrade'
        : plan.trialEligible
          ? 'Testar 15 dias grátis'
          : 'Assinar agora';

  async function handlePressCard() {
    setSavingMethod('card');
    const result = await selectPlan(plan.key);
    setSavingMethod(null);
    if (result.ok) {
      if (result.pix) {
        // Upgrade de plano anual no meio do ciclo - precisa pagar a diferença
        // proporcional antes do plano mudar de verdade. Se o plano na
        // resposta ainda não é o escolhido, é isso que está acontecendo.
        setPixModalUpgradeTarget(result.plan?.key !== plan.key ? plan.key : null);
        setPixModal(result.pix);
        return;
      }
      showAlert(
        'Plano atualizado',
        result.trialEndsAt
          ? `Você agora está no plano ${plan.name}. Seu teste grátis de 15 dias começou.`
          : `Você agora está no plano ${plan.name}.`
      );
      if (result.checkoutUrl) {
        WebBrowser.openBrowserAsync(result.checkoutUrl);
      }
    } else {
      showAlert('Não foi possível assinar', result.message);
    }
  }

  async function handlePressPix() {
    setSavingMethod('pix');
    const result = await selectPlanPix(plan.key, appliedCoupon?.code);
    setSavingMethod(null);
    if (result.ok) {
      if (result.pix) {
        setPixModalUpgradeTarget(result.plan?.key !== plan.key ? plan.key : null);
        setPixModal(result.pix);
      } else {
        showAlert(
          'Plano atualizado',
          `Você agora está no plano ${plan.name}. Seu teste grátis de 15 dias começou.`
        );
      }
    } else {
      showAlert('Não foi possível assinar', result.message);
    }
  }

  async function handleViewInvoice() {
    if (state.status !== 'authenticated') return;
    setCheckingInvoice(true);
    try {
      const { checkoutUrl } = await getCheckoutUrl(state.token);
      if (checkoutUrl) {
        WebBrowser.openBrowserAsync(checkoutUrl);
        return;
      }
      const { pix } = await getCurrentPixCharge(state.token);
      if (pix) {
        setPixModalUpgradeTarget(null);
        setPixModal(pix);
        return;
      }
      showAlert('Nenhuma fatura', 'Não encontramos uma fatura em aberto para esse plano.');
    } finally {
      setCheckingInvoice(false);
    }
  }

  const showInvoiceLink = isCurrent && (user?.subscriptionStatus === 'trialing' || user?.subscriptionStatus === 'past_due');

  return (
    <View className="mt-3 rounded-2xl border border-lucrei-border bg-lucrei-surface p-5">
      <Text className="text-xs font-semibold uppercase tracking-wide text-lucrei-gold">Plano {plan.name}</Text>

      {isCustomPricing ? (
        <Text className="mt-2 text-2xl font-bold text-lucrei-text">Sob consulta</Text>
      ) : (
        <>
          <View className="mt-2 flex-row items-baseline gap-2">
            {plan.priceOriginal !== null && (
              <Text className="text-sm text-lucrei-textMuted line-through">{formatBRL(plan.priceOriginal)}</Text>
            )}
            <Text className="text-2xl font-bold text-lucrei-text">{formatBRL(plan.priceCurrent!)}</Text>
            <Text className="text-sm text-lucrei-textMuted">{plan.billingPeriod === 'annual' ? '/ano' : '/mês'}</Text>
          </View>
          {plan.billingPeriod === 'annual' && (
            <Text className="mt-0.5 text-xs text-lucrei-textMuted">
              equivale a {formatBRL(plan.priceCurrent! / 12)}/mês
            </Text>
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
          {!isCurrent && (
            <Text className="mb-2 text-center text-xs font-medium text-lucrei-textMuted">{actionLabel}</Text>
          )}
          <View className="flex-row gap-2.5">
            <Pressable
              onPress={handlePressCard}
              disabled={isCurrent || savingMethod !== null}
              className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl bg-lucrei-gold py-3"
              style={{ opacity: isCurrent ? 0.5 : savingMethod ? 0.7 : 1 }}>
              {savingMethod === 'card' ? (
                <ActivityIndicator size="small" color={Colors.onGold} />
              ) : (
                <>
                  <Ionicons name="card-outline" size={16} color={Colors.onGold} />
                  <Text className="text-sm font-semibold text-lucrei-onGold">Cartão</Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={handlePressPix}
              disabled={isCurrent || savingMethod !== null}
              className="flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border border-lucrei-border py-3"
              style={{ opacity: isCurrent ? 0.5 : savingMethod ? 0.7 : 1 }}>
              {savingMethod === 'pix' ? (
                <ActivityIndicator size="small" color={Colors.gold} />
              ) : (
                <>
                  <Ionicons name="qr-code-outline" size={16} color={Colors.gold} />
                  <Text className="text-sm font-semibold text-lucrei-text">Pix</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      )}

      {!isCustomPricing && (
        <Text className="mt-3 text-[11px] leading-4 text-lucrei-textMuted">
          {plan.billingPeriod === 'annual'
            ? '*no cartão a cobrança se repete todo ano até você cancelar. No Pix, um código novo é gerado a cada ano.'
            : '*no cartão a cobrança se repete todo mês até você cancelar. No Pix, um código novo é gerado a cada mês.'}
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

      <PixPaymentModal
        visible={pixModal !== null}
        onClose={() => {
          setPixModal(null);
          setPixModalUpgradeTarget(null);
        }}
        pix={pixModal}
        expectedPlanKey={pixModalUpgradeTarget ?? undefined}
      />
    </View>
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

      <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
        {appliedCoupon ? (
          <View className="flex-row items-center justify-between">
            <View className="flex-1 flex-row items-center gap-2">
              <Ionicons name="pricetag" size={16} color={Colors.gold} />
              <Text className="flex-1 text-sm text-lucrei-text">
                Cupom <Text style={{ fontWeight: '700' }}>{appliedCoupon.code}</Text> aplicado —{' '}
                <Text style={{ color: Colors.gold, fontWeight: '600' }}>{appliedCoupon.percentOff}% off</Text> na
                1ª cobrança via Pix.
              </Text>
            </View>
            <Pressable onPress={handleClearCoupon} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
            </Pressable>
          </View>
        ) : (
          <>
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
              O desconto vale só na 1ª cobrança, pagando via Pix.
            </Text>
          </>
        )}
      </View>

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
        <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-8">
          {visiblePlans.map((plan) => (
            <PlanCard key={plan.key} plan={plan} appliedCoupon={appliedCoupon} />
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
