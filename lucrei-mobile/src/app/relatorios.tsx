import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { DailyProfitChart } from '@/components/daily-profit-chart';
import { Screen } from '@/components/screen';
import type { ThemeColors } from '@/constants/theme';
import { getShopeeProducts, getSummary, type Period, type ShopeeProduct, type Summary } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { useSelectedShop } from '@/lib/selected-shop';
import { useColors } from '@/lib/theme';

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

type AbcClass = 'A' | 'B' | 'C' | 'Z';

function getAbcBackground(cls: AbcClass, colors: ThemeColors) {
  return { A: colors.gold, B: colors.goldDim, C: colors.textMuted, Z: colors.danger }[cls];
}

// A e B caem numa superfície dourada (tinta escura fixa); C e Z são cinza/vermelho
// médios nos dois temas, onde branco lê melhor que a tinta de texto normal.
function getAbcInk(cls: AbcClass, colors: ThemeColors) {
  return cls === 'A' || cls === 'B' ? colors.onGold : '#FFFFFF';
}

const ABC_DESCRIPTION: Record<AbcClass, string> = {
  A: 'Poucos produtos, maior parte do faturamento',
  B: 'Contribuição intermediária',
  C: 'Muitos produtos, pouco faturamento',
  Z: 'Sem nenhuma venda no período',
};

function classifyAbc(products: ShopeeProduct[]) {
  const sold = products.filter((p) => p.orders > 0 && (p.revenue ?? 0) > 0);
  const unsold = products.filter((p) => !(p.orders > 0 && (p.revenue ?? 0) > 0));
  const sorted = [...sold].sort((a, b) => (b.revenue ?? 0) - (a.revenue ?? 0));
  const totalRevenue = sorted.reduce((sum, p) => sum + (p.revenue ?? 0), 0);

  let cumulative = 0;
  const classified = sorted.map((product) => {
    cumulative += product.revenue ?? 0;
    const cumPct = totalRevenue > 0 ? cumulative / totalRevenue : 0;
    const cls: AbcClass = cumPct <= 0.8 ? 'A' : cumPct <= 0.95 ? 'B' : 'C';
    return { product, cls, revenue: product.revenue ?? 0 };
  });

  const zClassified = unsold.map((product) => ({ product, cls: 'Z' as AbcClass, revenue: 0 }));

  return [...classified, ...zClassified];
}

function AbcBadge({ cls }: { cls: AbcClass }) {
  const Colors = useColors();
  return (
    <View
      className="h-7 w-7 items-center justify-center rounded-full"
      style={{ backgroundColor: getAbcBackground(cls, Colors) }}>
      <Text className="text-xs font-bold" style={{ color: getAbcInk(cls, Colors) }}>
        {cls}
      </Text>
    </View>
  );
}

function AbcRow({ item }: { item: { product: ShopeeProduct; cls: AbcClass; revenue: number } }) {
  return (
    <View className="flex-row items-center gap-3 rounded-xl border border-lucrei-border bg-lucrei-surface px-3 py-2.5">
      <AbcBadge cls={item.cls} />
      <Text className="flex-1 text-sm text-lucrei-text" numberOfLines={1}>
        {item.product.name}
      </Text>
      <Text className="text-sm text-lucrei-textMuted">{formatBRL(item.revenue)}</Text>
    </View>
  );
}

function ProductRankRow({ product }: { product: ShopeeProduct }) {
  const Colors = useColors();
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
  const Colors = useColors();
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

  const abcItems = classifyAbc(products);
  const abcCounts = (['A', 'B', 'C', 'Z'] as AbcClass[]).map((cls) => ({
    cls,
    count: abcItems.filter((i) => i.cls === cls).length,
  }));

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
              <Text className="text-xs font-medium" style={{ color: active ? Colors.onGold : Colors.textMuted }}>
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

          {abcItems.length > 0 && (
            <View className="rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
              <Text className="mb-1 text-sm font-medium text-lucrei-text">Curva ABC</Text>
              <Text className="mb-3 text-xs text-lucrei-textMuted">
                Classificação dos produtos pela contribuição no faturamento.
              </Text>

              <View className="mb-3 h-2 flex-row overflow-hidden rounded-full">
                {abcCounts
                  .filter((c) => c.count > 0)
                  .map((c) => (
                    <View
                      key={c.cls}
                      style={{ flex: c.count, backgroundColor: getAbcBackground(c.cls, Colors), height: '100%' }}
                    />
                  ))}
              </View>

              <View className="mb-3 flex-row flex-wrap gap-x-4 gap-y-1.5">
                {abcCounts
                  .filter((c) => c.count > 0)
                  .map((c) => (
                    <View key={c.cls} className="flex-row items-center gap-1.5">
                      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: getAbcBackground(c.cls, Colors) }} />
                      <Text className="text-xs text-lucrei-textMuted">
                        {c.cls}: {c.count} · {ABC_DESCRIPTION[c.cls]}
                      </Text>
                    </View>
                  ))}
              </View>

              <View className="gap-2">
                {abcItems.map((item) => (
                  <AbcRow key={item.product.shopeeItemId} item={item} />
                ))}
              </View>
            </View>
          )}

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
