import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { DailyProfitChart } from '@/components/daily-profit-chart';
import { Screen } from '@/components/screen';
import type { ThemeColors } from '@/constants/theme';
import {
  ApiError,
  getShopeeProducts,
  getSummary,
  getSummaryRange,
  syncOrdersHistory,
  type ShopeeProduct,
  type Summary,
} from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { exportOrdersCsv } from '@/lib/export-csv';
import { formatBRL } from '@/lib/format';
import { PERIOD_TO_API, PERIODS, usePeriod } from '@/lib/period';
import { useSelectedShop } from '@/lib/selected-shop';
import { useColors } from '@/lib/theme';

type LoadState = 'loading' | 'no-shop' | 'ready' | 'error';

const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

type ReportMode = 'month' | 'year' | 'lifetime';

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

function ReportRangeCard({
  token,
  shopId,
  connectedAt,
}: {
  token: string;
  shopId: string;
  connectedAt: string;
}) {
  const Colors = useColors();
  const now = new Date();
  const [mode, setMode] = useState<ReportMode>('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const range = useMemo(() => {
    if (mode === 'lifetime') return { from: new Date(connectedAt), to: new Date() };
    if (mode === 'year') return { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) };
    return { from: new Date(year, month - 1, 1), to: new Date(year, month, 1) };
  }, [mode, year, month, connectedAt]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getSummaryRange(token, shopId, range.from, range.to);
      setSummary(s);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [token, shopId, range]);

  useEffect(() => {
    load();
  }, [load]);

  function goPrev() {
    if (mode === 'year') {
      setYear((y) => y - 1);
    } else if (mode === 'month') {
      if (month === 1) {
        setMonth(12);
        setYear((y) => y - 1);
      } else {
        setMonth((m) => m - 1);
      }
    }
  }

  function goNext() {
    if (mode === 'year') {
      setYear((y) => y + 1);
    } else if (mode === 'month') {
      if (month === 12) {
        setMonth(1);
        setYear((y) => y + 1);
      } else {
        setMonth((m) => m + 1);
      }
    }
  }

  const nextDisabled =
    mode === 'year'
      ? year >= now.getFullYear()
      : year > now.getFullYear() || (year === now.getFullYear() && month >= now.getMonth() + 1);

  async function handleExport() {
    setExporting(true);
    try {
      await exportOrdersCsv(token, shopId, range.from, range.to);
    } catch (err) {
      showAlert('Não foi possível exportar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
    } finally {
      setExporting(false);
    }
  }

  async function handleBackfill() {
    setBackfilling(true);
    try {
      const result = await syncOrdersHistory(token, shopId);
      showAlert(
        'Histórico sincronizado',
        result.ordersSynced === 0
          ? 'Nenhum pedido novo encontrado no último ano.'
          : `${result.ordersSynced} pedido(s) do último ano foram trazidos pro Lucrei.`
      );
      await load();
    } catch (err) {
      showAlert('Não foi possível sincronizar o histórico', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
    } finally {
      setBackfilling(false);
    }
  }

  const label =
    mode === 'lifetime' ? 'Desde que conectei' : mode === 'year' ? String(year) : `${MONTH_NAMES[month - 1]} de ${year}`;

  return (
    <View className="rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
      <Text className="mb-3 text-sm font-medium text-lucrei-text">Relatório por período</Text>

      <View className="flex-row gap-2">
        {(['month', 'year', 'lifetime'] as ReportMode[]).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMode(m)}
            className="rounded-full px-3.5 py-1.5"
            style={{ backgroundColor: mode === m ? Colors.gold : Colors.surfaceAlt }}>
            <Text className="text-xs font-medium" style={{ color: mode === m ? Colors.onGold : Colors.textMuted }}>
              {m === 'month' ? 'Mês' : m === 'year' ? 'Ano' : 'Desde que conectei'}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode !== 'lifetime' ? (
        <View className="mt-3 flex-row items-center justify-center gap-4">
          <Pressable onPress={goPrev} hitSlop={8}>
            <Ionicons name="chevron-back" size={18} color={Colors.text} />
          </Pressable>
          <Text className="text-sm font-medium text-lucrei-text">{label}</Text>
          <Pressable onPress={goNext} disabled={nextDisabled} hitSlop={8} style={{ opacity: nextDisabled ? 0.3 : 1 }}>
            <Ionicons name="chevron-forward" size={18} color={Colors.text} />
          </Pressable>
        </View>
      ) : (
        <Text className="mt-3 text-center text-sm font-medium text-lucrei-text">{label}</Text>
      )}

      <View className="mt-4 border-t border-lucrei-border pt-3">
        {loading ? (
          <ActivityIndicator color={Colors.gold} />
        ) : summary ? (
          <View className="gap-1.5">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-lucrei-textMuted">Faturamento</Text>
              <Text className="text-sm text-lucrei-text">{formatBRL(summary.revenue)}</Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-lucrei-textMuted">Lucro</Text>
              <Text className="text-base font-bold" style={{ color: summary.profit >= 0 ? Colors.success : Colors.danger }}>
                {formatBRL(summary.profit)}
              </Text>
            </View>
            <Text className="text-xs text-lucrei-textMuted">
              {summary.ordersCount} {summary.ordersCount === 1 ? 'pedido' : 'pedidos'}
            </Text>
          </View>
        ) : (
          <Text className="text-sm text-lucrei-textMuted">Sem dados nesse período.</Text>
        )}
      </View>

      <Pressable
        onPress={handleExport}
        disabled={exporting}
        className="mt-4 flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-surfaceAlt px-4 py-3"
        style={{ opacity: exporting ? 0.6 : 1 }}>
        {exporting ? (
          <ActivityIndicator size="small" color={Colors.gold} />
        ) : (
          <Ionicons name="download-outline" size={16} color={Colors.gold} />
        )}
        <Text className="text-sm font-medium text-lucrei-gold">Exportar CSV</Text>
      </Pressable>

      <Pressable
        onPress={handleBackfill}
        disabled={backfilling}
        className="mt-2 flex-row items-center justify-center gap-2 rounded-xl px-4 py-3"
        style={{ opacity: backfilling ? 0.6 : 1 }}>
        {backfilling ? (
          <ActivityIndicator size="small" color={Colors.textMuted} />
        ) : (
          <Ionicons name="time-outline" size={16} color={Colors.textMuted} />
        )}
        <Text className="text-xs text-lucrei-textMuted">
          {backfilling ? 'Buscando histórico na Shopee, pode levar alguns minutos...' : 'Sincronizar histórico completo (último ano)'}
        </Text>
      </Pressable>
    </View>
  );
}

export default function RelatoriosScreen() {
  const { state } = useAuth();
  // Token em vez do objeto "state" inteiro: refreshUser() troca "state" por
  // um objeto novo a cada chamada (mesmo com os mesmos dados), o que
  // recarregava o relatório de novo sem necessidade.
  const token = state.status === 'authenticated' ? state.token : null;
  const Colors = useColors();
  const { selectedShop, loaded: shopsLoaded } = useSelectedShop();
  const { period, setPeriod } = usePeriod();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [products, setProducts] = useState<ShopeeProduct[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!token || !shopsLoaded) return;
    if (!selectedShop) {
      setLoadState('no-shop');
      return;
    }
    setLoadState((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const apiPeriod = PERIOD_TO_API[period];
      const [summaryRes, productsRes] = await Promise.all([
        getSummary(token, selectedShop.id, apiPeriod),
        getShopeeProducts(token, selectedShop.id, apiPeriod),
      ]);
      setSummary(summaryRes);
      setProducts(productsRes.products);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [token, shopsLoaded, selectedShop, period]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

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
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerClassName="mt-5 gap-3 pb-8"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.gold} />
          }>
          {token && selectedShop && (
            <ReportRangeCard token={token} shopId={selectedShop.id} connectedAt={selectedShop.connectedAt} />
          )}

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
