import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { DeltaBadge } from '@/components/delta-badge';
import { Screen } from '@/components/screen';
import { Sparkline } from '@/components/sparkline';
import { StatTile } from '@/components/stat-tile';
import { Colors } from '@/constants/theme';
import { ApiError, getShops, type Shop } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { connectShopeeStore } from '@/lib/shopee';

type BackendStatus = 'checking' | 'online' | 'offline';

const PERIODS = ['Hoje', '7 dias', '30 dias'] as const;

// Exemplo apenas — valores reais chegam quando a loja Shopee for conectada (Fase 2).
const MOCK_TREND = [18400, 19200, 21000, 20500, 23800, 26100, 27400, 31200, 33600, 35900, 38100, 40250];
const MOCK_KPIS = [
  { label: 'Faturamento', value: formatBRL(120750), deltaLabel: '+22,4%', deltaDirection: 'up' as const },
  {
    label: 'Custos totais',
    value: formatBRL(80500),
    deltaLabel: '+15,1%',
    deltaDirection: 'up' as const,
    positiveIsGood: false,
  },
  { label: 'Pedidos', value: '356', deltaLabel: '+12,1%', deltaDirection: 'up' as const },
  { label: 'Ticket médio', value: formatBRL(339.72), deltaLabel: '+8,3%', deltaDirection: 'up' as const },
  { label: 'Margem de lucro', value: '33,3%', deltaLabel: '+2,8 p.p.', deltaDirection: 'up' as const },
  {
    label: 'Devoluções',
    value: '12',
    deltaLabel: '-7,7%',
    deltaDirection: 'down' as const,
    positiveIsGood: false,
  },
];

export default function InicioScreen() {
  const { state } = useAuth();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('30 dias');
  const [connecting, setConnecting] = useState(false);
  const [shops, setShops] = useState<Shop[]>([]);

  async function loadShops() {
    if (state.status !== 'authenticated') return;
    try {
      const { shops } = await getShops(state.token);
      setShops(shops);
    } catch {
      // silencioso: a tela cai pro estado "nenhuma loja conectada"
    }
  }

  async function handleConnectShopee() {
    if (state.status !== 'authenticated') return;
    setConnecting(true);
    try {
      const result = await connectShopeeStore(state.token);
      if (result.status === 'success') {
        Alert.alert('Loja conectada!', 'Sua loja Shopee foi conectada com sucesso.');
        await loadShops();
      } else if (result.status === 'error') {
        Alert.alert('Não foi possível conectar', 'Tente novamente em instantes.');
      }
    } catch (err) {
      Alert.alert('Erro', err instanceof ApiError ? err.message : 'Algo deu errado.');
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    loadShops();
  }, [state.status]);

  useEffect(() => {
    const apiUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!apiUrl) {
      setBackendStatus('offline');
      return;
    }
    fetch(`${apiUrl}/health`)
      .then((res) => setBackendStatus(res.ok ? 'online' : 'offline'))
      .catch(() => setBackendStatus('offline'));
  }, []);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="pb-8">
        <View className="flex-row items-center justify-between">
          <View>
            <Text className="text-xl font-bold text-lucrei-text">Lucrei</Text>
            <View className="mt-0.5 flex-row items-center gap-1">
              <Text className="text-xs text-lucrei-textMuted">
                {shops[0]?.shopName ?? 'Nenhuma loja conectada'}
              </Text>
              <Ionicons name="chevron-down" size={12} color={Colors.textMuted} />
            </View>
          </View>
          <View
            className="h-2 w-2 rounded-full"
            style={{
              backgroundColor:
                backendStatus === 'online'
                  ? Colors.success
                  : backendStatus === 'offline'
                    ? Colors.danger
                    : Colors.textMuted,
            }}
          />
        </View>

        <View className="mt-5 flex-row self-start rounded-full bg-lucrei-surface p-1">
          {PERIODS.map((p) => {
            const active = p === period;
            return (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                className="rounded-full px-3.5 py-1.5"
                style={{ backgroundColor: active ? Colors.gold : 'transparent' }}>
                <Text
                  className="text-xs font-medium"
                  style={{ color: active ? Colors.bg : Colors.textMuted }}>
                  {p}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View className="mt-4 overflow-hidden rounded-3xl border border-lucrei-border">
          <LinearGradient
            colors={[Colors.surfaceAlt, Colors.surface]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View className="p-6">
            <Text className="text-sm text-lucrei-textMuted">Você lucrou</Text>
            <Text className="mt-1 text-5xl font-bold text-lucrei-gold">{formatBRL(40250)}</Text>
            <DeltaBadge label="+18,7% vs período anterior" direction="up" />

            <View className="mt-5">
              <Sparkline data={MOCK_TREND} />
            </View>
          </View>
        </View>

        <Text className="mt-6 text-sm font-medium text-lucrei-textMuted">Resumo do período</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-5 mt-3"
          contentContainerClassName="gap-3 px-5">
          {MOCK_KPIS.map((kpi) => (
            <StatTile key={kpi.label} {...kpi} />
          ))}
        </ScrollView>

        <Pressable
          onPress={handleConnectShopee}
          disabled={connecting}
          className="mt-8 flex-row items-center justify-center gap-2 rounded-2xl bg-lucrei-gold py-4"
          style={{ opacity: connecting ? 0.7 : 1 }}>
          {connecting ? (
            <ActivityIndicator color={Colors.bg} />
          ) : (
            <Ionicons name="storefront-outline" size={18} color={Colors.bg} />
          )}
          <Text className="text-base font-semibold text-lucrei-bg">
            {connecting ? 'Conectando...' : shops.length > 0 ? 'Conectar outra loja' : 'Conectar loja Shopee'}
          </Text>
        </Pressable>
        <Text className="mt-3 text-center text-xs text-lucrei-textMuted">
          {shops.length > 0
            ? `Loja conectada: ${shops[0].shopName}. Os números acima ainda são um exemplo — o sync de pedidos vem a seguir.`
            : 'Os números acima são um exemplo. Conecte sua loja para ver o seu lucro real.'}
        </Text>
      </ScrollView>
    </Screen>
  );
}
