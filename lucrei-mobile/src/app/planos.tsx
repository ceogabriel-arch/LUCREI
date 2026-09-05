import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

import { PixPaymentModal } from '@/components/pix-payment-modal';
import { Screen } from '@/components/screen';
import { getCheckoutUrl, getCurrentPixCharge, getPlans, type Plan, type PixCharge } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { useColors } from '@/lib/theme';

type LoadState = 'loading' | 'ready' | 'error';

function formatSalesLimit(limit: number | null) {
  return limit === null ? 'Sob consulta' : `${limit.toLocaleString('pt-BR')}/mês`;
}

function formatIntegrationsLimit(limit: number | null) {
  if (limit === null) return 'Ilimitadas';
  return limit === 1 ? '1 integração' : `${limit} integrações`;
}

function PlanCard({ plan }: { plan: Plan }) {
  const { state, selectPlan, selectPlanPix } = useAuth();
  const Colors = useColors();
  const [savingMethod, setSavingMethod] = useState<'card' | 'pix' | null>(null);
  const [checkingInvoice, setCheckingInvoice] = useState(false);
  const [pixModal, setPixModal] = useState<PixCharge | null>(null);
  const user = state.status === 'authenticated' ? state.user : null;
  const isCustomPricing = plan.priceCurrent === null;

  const isCurrent = user?.plan?.key === plan.key && user.subscriptionStatus !== 'canceled';
  const actionLabel = isCurrent
    ? 'Plano atual'
    : user?.plan?.key === plan.key
      ? 'Reativar plano'
      : user?.plan
        ? 'Fazer upgrade'
        : plan.key === 'start'
          ? 'Testar 15 dias grátis'
          : 'Assinar agora';

  async function handlePressCard() {
    setSavingMethod('card');
    const result = await selectPlan(plan.key);
    setSavingMethod(null);
    if (result.ok) {
      Alert.alert(
        'Plano atualizado',
        result.trialEndsAt
          ? `Você agora está no plano ${plan.name}. Seu teste grátis de 15 dias começou.`
          : `Você agora está no plano ${plan.name}.`
      );
      if (result.checkoutUrl) {
        WebBrowser.openBrowserAsync(result.checkoutUrl);
      }
    } else {
      Alert.alert('Não foi possível assinar', result.message);
    }
  }

  async function handlePressPix() {
    setSavingMethod('pix');
    const result = await selectPlanPix(plan.key);
    setSavingMethod(null);
    if (result.ok) {
      if (result.pix) {
        setPixModal(result.pix);
      } else {
        Alert.alert(
          'Plano atualizado',
          `Você agora está no plano ${plan.name}. Seu teste grátis de 15 dias começou.`
        );
      }
    } else {
      Alert.alert('Não foi possível assinar', result.message);
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
        setPixModal(pix);
        return;
      }
      Alert.alert('Nenhuma fatura', 'Não encontramos uma fatura em aberto para esse plano.');
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
        <View className="mt-2 flex-row items-baseline gap-2">
          {plan.priceOriginal !== null && (
            <Text className="text-sm text-lucrei-textMuted line-through">{formatBRL(plan.priceOriginal)}</Text>
          )}
          <Text className="text-2xl font-bold text-lucrei-text">{formatBRL(plan.priceCurrent!)}</Text>
          <Text className="text-sm text-lucrei-textMuted">/mês</Text>
        </View>
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
            Alert.alert('Plano Empresarial', 'Entre em contato com nosso time para um plano sob medida para o seu volume.')
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
          *no cartão a cobrança se repete todo mês até você cancelar. No Pix, um código novo é gerado a cada mês.
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

      <PixPaymentModal visible={pixModal !== null} onClose={() => setPixModal(null)} pix={pixModal} />
    </View>
  );
}

export default function PlanosScreen() {
  const router = useRouter();
  const Colors = useColors();
  const [state, setState] = useState<LoadState>('loading');
  const [plans, setPlans] = useState<Plan[]>([]);

  useEffect(() => {
    let cancelled = false;
    getPlans()
      .then(({ plans }) => {
        if (cancelled) return;
        setPlans(plans);
        setState('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setState('error');
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

      {state === 'loading' && (
        <View className="mt-10 items-center">
          <ActivityIndicator color={Colors.gold} />
        </View>
      )}

      {state === 'error' && (
        <View className="mt-10 items-center">
          <Text className="text-sm text-lucrei-danger">Não foi possível carregar os planos agora.</Text>
        </View>
      )}

      {state === 'ready' && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-8">
          {plans.map((plan) => (
            <PlanCard key={plan.key} plan={plan} />
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
