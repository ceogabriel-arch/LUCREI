import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { getPlans, type Plan } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';

const salesFormatter = new Intl.NumberFormat('pt-BR');

type LoadState = 'loading' | 'ready' | 'error';

function PlanCard({ plan }: { plan: Plan }) {
  const { state, selectPlan } = useAuth();
  const [saving, setSaving] = useState(false);
  const user = state.status === 'authenticated' ? state.user : null;

  const isCurrent = user?.plan?.key === plan.key && user.subscriptionStatus !== 'canceled';
  const label = isCurrent
    ? 'Plano atual'
    : user?.plan?.key === plan.key
      ? 'Reativar plano'
      : user?.plan
        ? 'Fazer upgrade'
        : 'Testar 15 dias grátis';

  async function handlePress() {
    setSaving(true);
    const result = await selectPlan(plan.key);
    setSaving(false);
    if (result.ok) {
      Alert.alert('Plano atualizado', `Você agora está no plano ${plan.name}.`);
    } else {
      Alert.alert('Não foi possível assinar', result.message);
    }
  }

  return (
    <View className="mt-3 rounded-2xl border border-lucrei-border bg-lucrei-surface p-5">
      <Text className="text-xs font-semibold uppercase tracking-wide text-lucrei-gold">Plano {plan.name}</Text>

      <Text className="mt-2 text-2xl font-bold text-lucrei-text">
        {plan.installments}x de {formatBRL(plan.priceInstallment)}
      </Text>
      <Text className="mt-0.5 text-sm text-lucrei-textMuted">ou {formatBRL(plan.priceUpfront)} à vista</Text>

      <View className="mt-4 gap-2">
        <View className="flex-row items-center gap-2">
          <Ionicons name="checkmark-circle" size={16} color={Colors.gold} />
          <Text className="text-sm text-lucrei-text">Vendas/ano – {salesFormatter.format(plan.salesPerYear)}</Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Ionicons name="checkmark-circle" size={16} color={Colors.gold} />
          <Text className="text-sm text-lucrei-text">Integrações – Ilimitadas</Text>
        </View>
      </View>

      <Pressable
        onPress={handlePress}
        disabled={isCurrent || saving}
        className="mt-5 items-center rounded-xl bg-lucrei-gold py-3"
        style={{ opacity: isCurrent ? 0.5 : saving ? 0.7 : 1 }}>
        {saving ? (
          <ActivityIndicator size="small" color={Colors.bg} />
        ) : (
          <Text className="text-sm font-semibold text-lucrei-bg">{label}</Text>
        )}
      </Pressable>

      <Text className="mt-3 text-[11px] leading-4 text-lucrei-textMuted">
        *essa cobrança se renovará um ano após a data da compra.
      </Text>
    </View>
  );
}

export default function PlanosScreen() {
  const router = useRouter();
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
        Todos os planos incluem 15 dias grátis para testar. Depois do teste, escolha o plano ideal para o volume de
        vendas da sua loja.
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
