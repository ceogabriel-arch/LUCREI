import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { DailyProfitChart } from '@/components/daily-profit-chart';
import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { getShopeeProducts, getSummary, type Period, type ShopeeProduct, type Summary } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { useSelectedShop } from '@/lib/selected-shop';

type LoadState = 'loading' | 'no-shop' | 'ready' | 'error';

const PERIODS = ['Hoje', '7 dias', '30 dias'] as const;
const PERIOD_TO_API: Record<(typeof PERIODS)[number], Period> = {
  Hoje: 'today',
  '7 dias': '7d',
  '30 dias': '30d',
};

function CostBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <View className="mb-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-lucrei-textMuted">{label}</Text>
        <Text className="text-xs text-lucrei-text">
          {formatBRL(value)} · {pct.toFixed(0)}%
        </Text>
      </View>
      <View className="mt-1.5 h-2 overflow-hidden rounded-full bg-lucrei-surfaceAlt">
        <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 999 }} />
      </View>
    </View>
  );
}

function ProductRankRow({ product }: { product: ShopeeProduct }) {
  const positive = (product.profit ?? 0) >= 0;
  return (
    <View className="flex-row items-center justify-between rounded-xl border border-lucrei-border bg-lucrei-surface px-3.5 py-3">
      <Text className="flex-1 pr-3 text-sm text-lucrei-text" numberOfLines={1}>
        {product.name}
      </Text>
      <Text className="text-sm font-semibold" style={{ color: positive ? Colors.success : Colors.danger }}>
        {formatBRL(product.profit ?? 0)}
      </Text>
    </View>
  );
}

export default function RelatoriosScreen() {
  const { state } = useAuth();
  const { selectedShop, loaded: shopsLoaded } = useSelectedShop();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [products, setProducts] = useState<ShopeeProduct[]>([]);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('30 dias');

  const load = useCallback(async () => {
    if (state.status !== 'authenticated' || !shopsLoaded) return;
    if (!selectedShop) {
      setLoadState('no-shop');
      return;
    }
    setLoadState((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const apiPeriod = PERIOD_TO_API[period];
      const [summaryRes, productsRes] = await Promise.all([
        getSummary(state.token, selectedShop.id, apiPeriod),
        getShopeeProducts(state.token, selectedShop.id, apiPeriod),
      ]);
      setSummary(summaryRes);
      setProducts(productsRes.products);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [state, shopsLoaded, selectedShop, period]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const sold = products.filter((p) => p.orders > 0);
  const topProfitable = [...sold].sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0)).slice(0, 5);
  const lossMakers = sold
    .filter((p) => (p.profit ?? 0) < 0)
    .sort((a, b) => (a.profit ?? 0) - (b.profit ?? 0))
    .slice(0, 5);

  return (
    <Screen>
      <Text className="text-2xl font-bold text-lucrei-text">Relatórios</Text>
      <Text className="mt-1 text-sm text-lucrei-textMuted">Pra onde vai o seu lucro.</Text>

      <View className="mt-5 flex-row self-start rounded-full bg-lucrei-surface p-1">
        {PERIODS.map((p) => {
          const active = p === period;
          return (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              className="rounded-full px-3.5 py-1.5"
              style={{ backgroundColor: active ? Colors.gold : 'transparent' }}>
              <Text className="text-xs font-medium" style={{ color: active ? Colors.bg : Colors.textMuted }}>
                {p}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loadState === 'loading' && (
        <View className="mt-10 items-center">
          <ActivityIndicator color={Colors.gold} />
        </View>
      )}

      {loadState === 'no-shop' && (
        <Text className="mt-8 text-sm text-lucrei-textMuted">
          Conecte uma loja Shopee na tela Início pra ver seus relatórios aqui.
        </Text>
      )}

      {loadState === 'error' && (
        <View className="mt-8 items-center gap-3">
          <Text className="text-sm text-lucrei-textMuted">Não foi possível carregar seus relatórios.</Text>
          <Pressable onPress={load} className="rounded-xl bg-lucrei-surface px-4 py-2">
            <Text className="text-sm text-lucrei-gold">Tentar de novo</Text>
          </Pressable>
        </View>
      )}

      {loadState === 'ready' && summary && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="mt-5 gap-3 pb-8">
          <View className="rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
            <Text className="text-sm font-medium text-lucrei-text">Lucro por dia</Text>
            <DailyProfitChart data={summary.trend} />
          </View>

          <View className="rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
            <Text className="mb-3 text-sm font-medium text-lucrei-text">Pra onde foi o dinheiro</Text>
            <CostBar label="Custo do produto" value={summary.productCost} total={summary.revenue} color={Colors.goldDim} />
            <CostBar label="Taxas da Shopee" value={summary.shopeeFees} total={summary.revenue} color={Colors.danger} />
            <CostBar label="Frete" value={summary.shippingCost} total={summary.revenue} color={Colors.textMuted} />
            <CostBar label="Lucro" value={summary.profit} total={summary.revenue} color={Colors.gold} />
            {summary.itemsMissingCost > 0 && (
              <Text className="mt-1 text-xs text-lucrei-textMuted">
                {summary.itemsMissingCost} item(ns) sem custo cadastrado, não entram nesse cálculo.
              </Text>
            )}
          </View>

          {topProfitable.length > 0 && (
            <View className="rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
              <Text className="mb-3 text-sm font-medium text-lucrei-text">Produtos mais lucrativos</Text>
              <View className="gap-2">
                {topProfitable.map((p) => (
                  <ProductRankRow key={p.shopeeItemId} product={p} />
                ))}
              </View>
            </View>
          )}

          {lossMakers.length > 0 && (
            <View className="rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
              <Text className="mb-3 text-sm font-medium text-lucrei-text">Produtos no prejuízo</Text>
              <View className="gap-2">
                {lossMakers.map((p) => (
                  <ProductRankRow key={p.shopeeItemId} product={p} />
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
