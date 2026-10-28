import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  type TextStyle,
  View,
} from 'react-native';

import { BlurredValue } from '@/components/blurred-value';
import { DailyProfitChart } from '@/components/daily-profit-chart';
import { GlassCard } from '@/components/glass-card';
import { HistoryBackfillCard } from '@/components/history-backfill-card';
import { MissingCostList } from '@/components/missing-cost-list';
import { PastDueBanner } from '@/components/past-due-banner';
import { PendingOrdersModal } from '@/components/pending-orders-modal';
import { Screen } from '@/components/screen';
import { ShopPicker } from '@/components/shop-picker';
import type { ThemeColors } from '@/constants/theme';
import {
  ApiError,
  getCombinedOrderForecast,
  getCombinedSummary,
  getCombinedSummaryRange,
  getOrderForecast,
  getProductReport,
  getShopeeProducts,
  getSummary,
  getSummaryRange,
  type OrderForecast,
  type Period,
  type ProductReport,
  type ShopeeProduct,
  type Summary,
} from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { useDataRefresh } from '@/lib/data-refresh';
import { exportOrdersCsv, exportOrdersExcel, exportProductExcel, exportProductsExcel } from '@/lib/export-csv';
import { formatBRL } from '@/lib/format';
import { MERCADO_LIVRE_ORDER_STATUS_LABELS, ORDER_STATUS_LABELS } from '@/lib/order-status-labels';
import { webCapWidth } from '@/lib/responsive';
import { useSelectedShop } from '@/lib/selected-shop';
import { useSubscriptionAccess } from '@/lib/subscription-access';
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

type ProductReportPeriodLabel = 'Hoje' | '7 dias' | '30 dias' | '3 meses';
const PRODUCT_REPORT_PERIODS: ProductReportPeriodLabel[] = ['Hoje', '7 dias', '30 dias', '3 meses'];
const PRODUCT_REPORT_PERIOD_TO_API: Record<ProductReportPeriodLabel, Period> = {
  Hoje: 'today',
  '7 dias': '7d',
  '30 dias': '30d',
  '3 meses': '90d',
};

// RN Web desenha o anel de foco padrão do navegador em volta do TextInput
// (aparece como uma borda clara mesmo no tema escuro) - mesmo fix usado em
// text-field.tsx/password-field.tsx.
const webOutlineStyle: TextStyle | undefined =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : undefined;

// Busca/seleciona 1 produto dentro da lista já carregada pro período fixo da
// tela (só pra achar o produto pelo nome) - os totais mostrados aqui vêm de
// uma chamada própria (getProductReport), já que esse card tem seu próprio
// seletor de período, independente do resto de Relatórios.
function ProductReportCard({
  token,
  fallbackShopId,
  products,
  blurred,
}: {
  token: string;
  // Produto em "Todas as lojas" já carrega o shopId dele (ver load() mais
  // abaixo); numa loja só, o produto nunca tem isso preenchido (óbvio qual
  // loja é), então cai nessa loja selecionada.
  fallbackShopId: string | null;
  products: ShopeeProduct[];
  blurred: boolean;
}) {
  const Colors = useColors();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<ShopeeProduct | null>(null);
  const [period, setPeriod] = useState<ProductReportPeriodLabel>('30 dias');
  const [report, setReport] = useState<ProductReport | null>(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [exportingSelected, setExportingSelected] = useState(false);
  const [periodCounts, setPeriodCounts] = useState<Map<string, number> | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);

  const resolveShopId = (p: ShopeeProduct) => p.shopId ?? fallbackShopId ?? '';
  const keyFor = (p: ShopeeProduct) => `${resolveShopId(p)}-${p.shopeeItemId}`;
  // "orders" vindo de products já é fixo em 30 dias (ver load() da tela) -
  // bate com o período padrão daqui, mas Hoje/7 dias/3 meses precisam
  // recalcular esse número por conta própria (periodCounts), senão o card
  // mostra a mesma contagem de 30 dias não importa o período escolhido
  // (achado ao vivo: clicava "Hoje" e continuava aparecendo "94 pedidos").
  const ordersFor = (p: ShopeeProduct) => periodCounts?.get(keyFor(p)) ?? p.orders;

  const shopIds = [...new Set(products.map(resolveShopId).filter((id) => id !== ''))];

  // Dropdown abre no foco mesmo sem digitar nada (lista os produtos
  // ordenados por quem mais vendeu) - sem digitar nada antes, não dava pra
  // ver que existia mais de um anúncio com o nome quase igual (achado ao
  // vivo: dois produtos chamados exatamente igual, pedidos quase todos
  // concentrados só num deles). Sem corte em 8 - a lista rola dentro de uma
  // altura fixa em vez de esconder o resto (outro problema achado ao vivo).
  const matches = !open
    ? []
    : query.trim().length === 0
      ? [...products].sort((a, b) => ordersFor(b) - ordersFor(a))
      : products.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => {
    // 30 dias é o período que já vem pronto em "products" (ver comentário
    // acima) - só busca de novo pros outros períodos.
    if (period === '30 dias' || shopIds.length === 0) {
      setPeriodCounts(null);
      return;
    }

    let cancelled = false;
    setLoadingCounts(true);
    Promise.all(shopIds.map((shopId) => getShopeeProducts(token, shopId, PRODUCT_REPORT_PERIOD_TO_API[period])))
      .then((results) => {
        if (cancelled) return;
        const map = new Map<string, number>();
        results.forEach((res, i) => {
          for (const p of res.products) map.set(`${shopIds[i]}-${p.shopeeItemId}`, p.orders);
        });
        setPeriodCounts(map);
      })
      .catch(() => {
        if (!cancelled) setPeriodCounts(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingCounts(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- shopIds é recalculado toda render a partir de products; comparar pelo conteúdo evitaria refetch desnecessário, mas o array já é curto (poucas lojas).
  }, [period, shopIds.join(','), token]);

  useEffect(() => {
    // Selecionar/limpar produto já zera "report" direto no handler (abaixo) -
    // esse efeito só cuida de buscar o relatório pro produto/período atual.
    if (!selected) return;
    const shopId = selected.shopId ?? fallbackShopId;
    if (!shopId) return;

    let cancelled = false;
    setLoadingReport(true);
    getProductReport(token, shopId, selected.shopeeItemId, PRODUCT_REPORT_PERIOD_TO_API[period], selected.name)
      .then((data) => {
        if (!cancelled) setReport(data);
      })
      .catch((err) => {
        if (!cancelled) {
          showAlert('Não foi possível carregar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingReport(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected, period, token, fallbackShopId]);

  function handleSelect(product: ShopeeProduct) {
    setSelected(product);
    setReport(null);
    setQuery('');
    setOpen(false);
  }

  function handleClear() {
    setSelected(null);
    setReport(null);
    setQuery('');
  }

  async function handleExport() {
    const shopId = selected?.shopId ?? fallbackShopId;
    if (!selected || !shopId) return;
    setExporting(true);
    try {
      await exportProductExcel(token, shopId, selected.shopeeItemId, PRODUCT_REPORT_PERIOD_TO_API[period], selected.name);
    } catch (err) {
      showAlert('Não foi possível exportar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
    } finally {
      setExporting(false);
    }
  }

  function toggleChecked(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleExportSelected() {
    const items = products
      .filter((p) => checked.has(keyFor(p)))
      .map((p) => ({ shopId: resolveShopId(p), itemId: p.shopeeItemId, name: p.name }))
      .filter((i) => i.shopId !== '');
    if (items.length === 0) return;
    setExportingSelected(true);
    try {
      await exportProductsExcel(token, items, PRODUCT_REPORT_PERIOD_TO_API[period]);
      setChecked(new Set());
    } catch (err) {
      showAlert('Não foi possível exportar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
    } finally {
      setExportingSelected(false);
    }
  }

  return (
    <GlassCard className="p-4" borderRadius={16}>
      <Text className="mb-3 text-sm font-medium text-lucrei-text">Relatório por produto</Text>

      <View className="mb-3 flex-row items-center gap-2">
        <View className="flex-row self-start rounded-full bg-lucrei-surfaceAlt p-1" style={{ opacity: loadingCounts ? 0.5 : 1 }}>
          {PRODUCT_REPORT_PERIODS.map((p) => {
            const active = p === period;
            return (
              <Pressable
                key={p}
                onPress={() => setPeriod(p)}
                disabled={loadingCounts}
                className="rounded-full px-3 py-1.5"
                style={{ backgroundColor: active ? Colors.gold : 'transparent' }}>
                <Text className="text-xs font-medium" style={{ color: active ? Colors.onGold : Colors.textMuted }}>
                  {p}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {loadingCounts && <ActivityIndicator size="small" color={Colors.gold} />}
      </View>

      {selected ? (
        <View>
          <View className="flex-row items-center justify-between">
            <Text className="flex-1 pr-3 text-sm font-medium text-lucrei-text" numberOfLines={2}>
              {selected.name}
              {selected.shopName ? ` · ${selected.shopName}` : ''}
            </Text>
            <Pressable onPress={handleClear} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={Colors.textMuted} />
            </Pressable>
          </View>

          <View className="mt-3 gap-1.5 border-t border-lucrei-border pt-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-lucrei-textMuted">Faturamento no período</Text>
              {blurred ? (
                <BlurredValue width={70} />
              ) : loadingReport || !report ? (
                <ActivityIndicator size="small" color={Colors.gold} />
              ) : (
                <Text className="text-sm text-lucrei-text">{formatBRL(report.revenue)}</Text>
              )}
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-lucrei-textMuted">Lucro no período</Text>
              {blurred ? (
                <BlurredValue width={90} height={16} />
              ) : loadingReport || !report ? (
                <ActivityIndicator size="small" color={Colors.gold} />
              ) : (
                <Text
                  className="text-base font-bold"
                  style={{ color: (report.profit ?? 0) >= 0 ? Colors.success : Colors.danger }}>
                  {formatBRL(report.profit ?? 0)}
                </Text>
              )}
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-xs text-lucrei-textMuted">Quantidade vendida</Text>
              <Text className="text-sm text-lucrei-text">{loadingReport || !report ? '–' : report.quantitySold}</Text>
            </View>
          </View>
          {report && report.itemsMissingCost > 0 && (
            <Text className="mt-2 text-xs text-lucrei-textMuted">
              Esse produto ainda não tem custo cadastrado, por isso o lucro não aparece.
            </Text>
          )}

          {report && report.pendingOrders.length > 0 && (
            <View className="mt-3 gap-1.5 border-t border-lucrei-border pt-3">
              <Text className="text-xs text-lucrei-textMuted">
                + {report.pendingOrders.length}{' '}
                {report.pendingOrders.length === 1 ? 'pedido ainda não concluído' : 'pedidos ainda não concluídos'}
              </Text>
              {report.pendingOrders.map((order) => {
                const statusLabels = order.provider === 'mercado_livre' ? MERCADO_LIVRE_ORDER_STATUS_LABELS : ORDER_STATUS_LABELS;
                return (
                  <View key={order.orderSn} className="flex-row items-center justify-between">
                    <Text className="flex-1 pr-3 text-xs text-lucrei-text" numberOfLines={1}>
                      {statusLabels[order.status] ?? order.status}
                    </Text>
                    <Text className="text-xs text-lucrei-textMuted">x{order.quantity}</Text>
                  </View>
                );
              })}
            </View>
          )}

          <Pressable
            onPress={handleExport}
            disabled={exporting}
            className="mt-3 flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-surfaceAlt px-4 py-3"
            style={{ opacity: exporting ? 0.6 : 1 }}>
            {exporting ? (
              <ActivityIndicator size="small" color={Colors.gold} />
            ) : (
              <Ionicons name="grid-outline" size={16} color={Colors.gold} />
            )}
            <Text className="text-sm font-medium text-lucrei-gold">Exportar Excel</Text>
          </Pressable>
        </View>
      ) : (
        <View>
          <View
            className="flex-row items-center rounded-xl border border-lucrei-border bg-lucrei-bg px-3.5"
            style={{ opacity: loadingCounts ? 0.6 : 1 }}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              onFocus={() => setOpen(true)}
              // Delay pra deixar o onPress de um item da lista disparar antes
              // (ele seleciona o produto e fecha sozinho) - sem isso o blur
              // fecha a lista antes do toque registrar.
              onBlur={() => setTimeout(() => setOpen(false), 150)}
              editable={!loadingCounts}
              placeholder="Buscar produto pelo nome..."
              placeholderTextColor={Colors.textMuted}
              autoCorrect={false}
              className="flex-1 py-2.5 text-sm text-lucrei-text"
              style={webOutlineStyle}
            />
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textMuted} />
          </View>
          {matches.length > 0 && (
            <View className="mt-2 overflow-hidden rounded-xl bg-lucrei-surface">
              <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {matches.map((product, index) => {
                  const key = keyFor(product);
                  const isChecked = checked.has(key);
                  const orders = ordersFor(product);
                  return (
                    <View
                      key={`${key}-${index}`}
                      className="flex-row items-center"
                      style={index > 0 ? { borderTopWidth: 1, borderTopColor: Colors.border } : undefined}>
                      <Pressable onPress={() => toggleChecked(key)} hitSlop={8} className="px-3 py-2.5">
                        <Ionicons
                          name={isChecked ? 'checkbox' : 'square-outline'}
                          size={19}
                          color={isChecked ? Colors.gold : Colors.textMuted}
                        />
                      </Pressable>
                      <Pressable
                        onPress={() => handleSelect(product)}
                        className="flex-1 flex-row items-center justify-between py-2.5 pr-3.5">
                        <Text className="flex-1 pr-3 text-sm text-lucrei-text" numberOfLines={1}>
                          {product.name}
                          {product.shopName ? ` · ${product.shopName}` : ''}
                        </Text>
                        {loadingCounts ? (
                          <ActivityIndicator size="small" color={Colors.textMuted} />
                        ) : (
                          <Text className="text-xs text-lucrei-textMuted">
                            {orders} {orders === 1 ? 'pedido' : 'pedidos'}
                          </Text>
                        )}
                      </Pressable>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          )}
          {open && query.trim().length > 0 && matches.length === 0 && (
            <Text className="mt-2 text-xs text-lucrei-textMuted">Nenhum produto encontrado com esse nome.</Text>
          )}

          {checked.size > 0 && (
            <Pressable
              onPress={handleExportSelected}
              disabled={exportingSelected}
              className="mt-3 flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-surfaceAlt px-4 py-3"
              style={{ opacity: exportingSelected ? 0.6 : 1 }}>
              {exportingSelected ? (
                <ActivityIndicator size="small" color={Colors.gold} />
              ) : (
                <Ionicons name="grid-outline" size={16} color={Colors.gold} />
              )}
              <Text className="text-sm font-medium text-lucrei-gold">
                Exportar {checked.size} {checked.size === 1 ? 'produto' : 'produtos'}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </GlassCard>
  );
}

function ReportRangeCard({
  token,
  shopId,
  connectedAt,
  isShopee,
}: {
  token: string;
  // null = "Todas as lojas" (resumo somado, sem CSV nem backfill - essas
  // duas ações continuam sendo por loja só).
  shopId: string | null;
  connectedAt: string;
  // Backfill de histórico só existe pra Shopee (ML ainda não sincroniza
  // pedido) - mostrar o botão pra uma loja ML garantia falha, com um texto
  // que ainda por cima dizia "na Shopee" pra loja errada.
  isShopee: boolean;
}) {
  const Colors = useColors();
  const subscriptionAccess = useSubscriptionAccess();
  const now = new Date();
  const [mode, setMode] = useState<ReportMode>('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [forecast, setForecast] = useState<OrderForecast | null>(null);
  const [pendingOrdersOpen, setPendingOrdersOpen] = useState(false);
  const prevShopIdRef = useRef<string | null>(shopId);

  const range = useMemo(() => {
    if (mode === 'lifetime') return { from: new Date(connectedAt), to: new Date() };
    if (mode === 'year') return { from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) };
    return { from: new Date(year, month - 1, 1), to: new Date(year, month, 1) };
  }, [mode, year, month, connectedAt]);

  const load = useCallback(async () => {
    if (prevShopIdRef.current !== shopId) {
      prevShopIdRef.current = shopId;
      setSummary(null);
    }
    setLoading(true);
    try {
      const s =
        shopId === null
          ? mode === 'lifetime'
            ? // "Desde que conectei" combinado usa a mesma lógica do lucro
              // vitalício das conquistas - cada loja soma a partir da SUA
              // própria data de conexão (period=all), não faz sentido um
              // "from" único pra todas.
              await getCombinedSummary(token, 'all')
            : await getCombinedSummaryRange(token, range.from, range.to)
          : await getSummaryRange(token, shopId, range.from, range.to);
      setSummary(s);
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [token, shopId, range, mode]);

  useEffect(() => {
    load();
  }, [load]);

  // Igual ao card "Previsão de lucro" da Início: pedido já comprado mas
  // ainda não concluído em nenhum marketplace, sem filtro de período (é
  // sempre "quanto tem em aberto agora"), pra explicar a diferença entre o
  // que aparece aqui e o painel da própria Shopee/Mercado Livre.
  useEffect(() => {
    let cancelled = false;
    (shopId === null ? getCombinedOrderForecast(token) : getOrderForecast(token, shopId))
      .then((f) => {
        if (!cancelled) setForecast(f);
      })
      .catch(() => {
        if (!cancelled) setForecast(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, shopId]);

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

  async function handleExportExcel() {
    setExportingExcel(true);
    try {
      await exportOrdersExcel(token, shopId, range.from, range.to);
    } catch (err) {
      showAlert('Não foi possível exportar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
    } finally {
      setExportingExcel(false);
    }
  }

  const label =
    mode === 'lifetime' ? 'Desde que conectei' : mode === 'year' ? String(year) : `${MONTH_NAMES[month - 1]} de ${year}`;

  return (
    <GlassCard className="p-4" borderRadius={16}>
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
          subscriptionAccess.isPastDue ? (
            <View className="gap-1.5">
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-lucrei-textMuted">Faturamento</Text>
                <BlurredValue width={70} />
              </View>
              <View className="flex-row items-center justify-between">
                <Text className="text-xs text-lucrei-textMuted">Lucro</Text>
                <BlurredValue width={90} height={16} />
              </View>
            </View>
          ) : (
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
          )
        ) : (
          <Text className="text-sm text-lucrei-textMuted">Sem dados nesse período.</Text>
        )}
      </View>

      {/* Pedido já comprado mas ainda não concluído em nenhum marketplace -
          explica por que o painel da própria Shopee/Mercado Livre costuma
          mostrar mais pedidos/faturamento que o resumo acima: aqui só conta
          o que já fechou de verdade. Some daqui e entra no resumo sozinho
          assim que o pedido concluir, sem precisar sincronizar de novo. */}
      {forecast !== null && forecast.pendingCount > 0 && (
        <Pressable
          onPress={() => setPendingOrdersOpen(true)}
          hitSlop={4}
          style={({ pressed }) => [
            { borderColor: Colors.goldDim, backgroundColor: Colors.surfaceAlt, opacity: pressed ? 0.7 : 1 },
          ]}
          className="mt-3 flex-row items-center justify-between rounded-2xl border border-dashed p-3.5">
          <View className="flex-1 pr-3">
            <Text className="text-sm font-medium text-lucrei-text">+ {forecast.pendingCount}{' '}
              {forecast.pendingCount === 1 ? 'pedido ainda não concluído' : 'pedidos ainda não concluídos'}
            </Text>
            <Text className="mt-0.5 text-xs text-lucrei-textMuted">Ainda em processamento no marketplace. Toque pra ver.</Text>
          </View>
          {subscriptionAccess.isPastDue ? (
            <BlurredValue width={70} />
          ) : (
            <Text className="text-sm font-bold" style={{ color: Colors.goldDim }}>
              + {formatBRL(forecast.projectedProfit)}
            </Text>
          )}
        </Pressable>
      )}

      <PendingOrdersModal
        visible={pendingOrdersOpen}
        onClose={() => setPendingOrdersOpen(false)}
        token={token}
        shopId={shopId}
      />

      <View className="mt-4 flex-row gap-2">
        <Pressable
          onPress={handleExport}
          disabled={exporting}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-surfaceAlt px-4 py-3"
          style={{ opacity: exporting ? 0.6 : 1 }}>
          {exporting ? (
            <ActivityIndicator size="small" color={Colors.gold} />
          ) : (
            <Ionicons name="download-outline" size={16} color={Colors.gold} />
          )}
          <Text className="text-sm font-medium text-lucrei-gold">Exportar CSV</Text>
        </Pressable>
        <Pressable
          onPress={handleExportExcel}
          disabled={exportingExcel}
          className="flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-lucrei-surfaceAlt px-4 py-3"
          style={{ opacity: exportingExcel ? 0.6 : 1 }}>
          {exportingExcel ? (
            <ActivityIndicator size="small" color={Colors.gold} />
          ) : (
            <Ionicons name="grid-outline" size={16} color={Colors.gold} />
          )}
          <Text className="text-sm font-medium text-lucrei-gold">Exportar Excel</Text>
        </Pressable>
      </View>

      {/* Backfill de histórico continua sendo ação de uma loja Shopee só -
          com "Todas as lojas" (shopId null) não tem pra qual loja apontar. */}
      {shopId !== null && isShopee && (
        <View className="mt-2">
          <HistoryBackfillCard token={token} shopId={shopId} onSynced={load} prominent />
        </View>
      )}
    </GlassCard>
  );
}

export default function RelatoriosScreen() {
  const { state, refreshUser } = useAuth();
  // Token em vez do objeto "state" inteiro: refreshUser() troca "state" por
  // um objeto novo a cada chamada (mesmo com os mesmos dados), o que
  // recarregava o relatório de novo sem necessidade.
  const token = state.status === 'authenticated' ? state.token : null;
  const Colors = useColors();
  const { shops, selectedShop, viewingAll, loaded: shopsLoaded } = useSelectedShop();
  const activeShops = useMemo(() => shops.filter((s) => s.status === 'active'), [shops]);
  const { refreshSignal } = useDataRefresh();
  const subscriptionAccess = useSubscriptionAccess();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [products, setProducts] = useState<ShopeeProduct[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // Trocar de período com a tela já pronta mantém loadState em 'ready' (de
  // propósito, pra não piscar a tela inteira de loading) - sem isso, nada
  // avisa que os números estão recalculando enquanto o pedido não volta. Mas
  // trocar de LOJA precisa continuar mostrando loading - senão o número da
  // loja anterior fica na tela com cara de travado, enquanto na real já
  // está buscando o resumo certo (reportado ao vivo).
  const [reloading, setReloading] = useState(false);
  const prevShopKeyRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!token || !shopsLoaded) return;
    if (viewingAll ? activeShops.length === 0 : !selectedShop) {
      setLoadState('no-shop');
      return;
    }
    const shopKey = viewingAll ? 'all' : (selectedShop?.id ?? null);
    const shopChanged = prevShopKeyRef.current !== shopKey;
    prevShopKeyRef.current = shopKey;

    setLoadState((prev) => (prev === 'ready' && !shopChanged ? prev : 'loading'));
    if (shopChanged) {
      setSummary(null);
      setProducts([]);
    }
    setReloading(true);
    try {
      // Fixo em 30 dias - "Hoje"/"7 dias" não faziam sentido pra um
      // relatório (ninguém olha Curva ABC/produto mais lucrativo do dia).
      const apiPeriod = '30d';
      if (viewingAll) {
        const [summaryRes, productsPerShop] = await Promise.all([
          getCombinedSummary(token, apiPeriod),
          Promise.all(
            activeShops.map((shop) =>
              getShopeeProducts(token, shop.id, apiPeriod).then((res) =>
                res.products.map((p) => ({ ...p, shopName: shop.shopName, shopId: shop.id }))
              )
            )
          ),
        ]);
        setSummary(summaryRes);
        setProducts(productsPerShop.flat());
      } else if (selectedShop) {
        const [summaryRes, productsRes] = await Promise.all([
          getSummary(token, selectedShop.id, apiPeriod),
          getShopeeProducts(token, selectedShop.id, apiPeriod),
        ]);
        setSummary(summaryRes);
        setProducts(productsRes.products);
      }
      setLoadState('ready');
    } catch {
      setLoadState('error');
    } finally {
      setReloading(false);
    }
  }, [token, shopsLoaded, selectedShop, viewingAll, activeShops]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
      // Status de pagamento (subscriptionBlocked/subscriptionGraceDaysLeft)
      // só atualiza quando o objeto "user" é recarregado - sem isso, essa
      // tela continuava mostrando um aviso de carência desatualizado até o
      // usuário passar pela tela Início (a única que já chamava isso).
      refreshUser();
    }, [load, refreshUser])
  );

  // Pedido concluído chegando via push (ver DataRefreshProvider em
  // _layout.tsx) - recarrega sozinho, sem esperar o usuário puxar pra
  // atualizar. refreshSignal > 0 evita recarregar de novo no mount (os
  // efeitos acima já cobrem isso).
  useEffect(() => {
    if (refreshSignal > 0) load();
  }, [refreshSignal, load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const sold = products.filter((p) => p.orders > 0);
  // shopId já vem preenchido em cada item no modo "Todas as lojas" (ver
  // load() acima) - só falta no modo loja única, onde products.shopId nunca
  // é setado porque é óbvio qual loja é (mas o MissingCostList precisa dele
  // pra saber onde salvar o custo).
  const missingCostItems = sold
    .filter((p) => p.costPrice == null)
    .map((p) => ({ ...p, shopId: p.shopId ?? selectedShop?.id ?? '' }))
    .filter((p) => p.shopId !== '');
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

  // "Shopee" só faz sentido nesse texto quando a loja selecionada é
  // realmente uma Shopee - mesmo problema já corrigido na Início ("Líquido
  // Shopee" aparecendo pra loja Mercado Livre).
  const marketplaceLabelLower = viewingAll ? 'do marketplace' : selectedShop?.provider === 'mercado_livre' ? 'do Mercado Livre' : 'da Shopee';

  return (
    <Screen>
      {/* Cabeçalho fica fora do ScrollView (de propósito, pra não rolar
          junto) - precisa do mesmo teto de largura que o conteúdo rolável
          abaixo, senão desalinha num monitor bem largo (título lá na
          esquerda, cards centralizados mais pra dentro). */}
      <View style={webCapWidth()}>
      <Text className="text-2xl font-bold text-lucrei-text">Relatórios</Text>
      <Text className="mt-1 text-sm text-lucrei-textMuted">Pra onde vai o seu lucro.</Text>
      {activeShops.length > 1 && <ShopPicker />}

      {loadState === 'ready' && reloading && (
        <View className="mt-5 flex-row items-center">
          <ActivityIndicator size="small" color={Colors.gold} />
        </View>
      )}

      {loadState === 'loading' && (
        <View className="mt-10 items-center">
          <ActivityIndicator color={Colors.gold} />
        </View>
      )}

      {loadState === 'no-shop' && (
        <Text className="mt-8 text-sm text-lucrei-textMuted">
          Conecte uma loja Shopee ou Mercado Livre na tela Início pra ver seus relatórios aqui.
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
      </View>

      {loadState === 'ready' && summary && (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerClassName="mt-5 gap-3 pb-8"
          contentContainerStyle={webCapWidth()}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.gold} />
          }>
          {/* Em "Todas as lojas", o resumo por mês/ano/desde que conectei
              soma normalmente (o backend já aceita from/to pra todas as
              lojas) - só Exportar CSV e Sincronizar histórico continuam
              escondidos ali dentro, por serem ação de uma loja só. */}
          {token && (viewingAll ? activeShops.length > 0 : selectedShop) && (
            <ReportRangeCard
              token={token}
              shopId={viewingAll ? null : selectedShop!.id}
              connectedAt={viewingAll ? (selectedShop?.connectedAt ?? new Date().toISOString()) : selectedShop!.connectedAt}
              isShopee={viewingAll ? false : selectedShop!.provider !== 'mercado_livre'}
            />
          )}

          <PastDueBanner />

          {subscriptionAccess.isPastDue ? (
            <GlassCard className="items-center p-6" borderRadius={16}>
              <Ionicons name="lock-closed" size={20} color={Colors.textMuted} />
              <Text className="mt-2 text-center text-sm text-lucrei-textMuted">
                Gráficos e detalhamento de lucro ficam ocultos até você regularizar o pagamento.
              </Text>
            </GlassCard>
          ) : (
            <>
              <GlassCard className="p-4" borderRadius={16}>
                <Text className="text-sm font-medium text-lucrei-text">Lucro por dia</Text>
                <DailyProfitChart data={summary.trend} />
              </GlassCard>

              {token && products.length > 0 && (
                <ProductReportCard
                  token={token}
                  fallbackShopId={viewingAll ? null : (selectedShop?.id ?? null)}
                  products={products}
                  blurred={subscriptionAccess.isPastDue}
                />
              )}

              <GlassCard className="p-4" borderRadius={16}>
                <Text className="mb-3 text-sm font-medium text-lucrei-text">Pra onde foi o dinheiro</Text>
                {summary.revenue > 0 && (
                  <View className="mb-4 h-3 flex-row overflow-hidden rounded-full">
                    {[
                      { value: summary.productCost, color: Colors.goldDim },
                      { value: summary.shopeeFees, color: Colors.danger },
                      { value: summary.shippingCost, color: Colors.textMuted },
                      { value: summary.taxCost, color: Colors.danger },
                      { value: Math.max(summary.profit, 0), color: Colors.gold },
                    ]
                      .filter((segment) => segment.value > 0)
                      .map((segment, index) => (
                        <View key={index} style={{ flex: segment.value, backgroundColor: segment.color, height: '100%' }} />
                      ))}
                  </View>
                )}
                <CostBar label="Custo do produto" value={summary.productCost} total={summary.revenue} color={Colors.goldDim} />
                <CostBar label={`Taxas ${marketplaceLabelLower}`} value={summary.shopeeFees} total={summary.revenue} color={Colors.danger} />
                <CostBar label="Frete" value={summary.shippingCost} total={summary.revenue} color={Colors.textMuted} />
                {summary.taxCost > 0 && (
                  <CostBar label="Imposto" value={summary.taxCost} total={summary.revenue} color={Colors.danger} />
                )}
                <CostBar label="Lucro" value={summary.profit} total={summary.revenue} color={Colors.gold} />
                {summary.itemsMissingCost > 0 && token && (
                  <MissingCostList token={token} items={missingCostItems} onSaved={load} />
                )}
              </GlassCard>

              {abcItems.length > 0 && (
                <GlassCard className="p-4" borderRadius={16}>
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
                      <AbcRow key={`${item.product.shopId ?? ''}-${item.product.shopeeItemId}`} item={item} />
                    ))}
                  </View>
                </GlassCard>
              )}

              {topProfitable.length > 0 && (
                <GlassCard className="p-4" borderRadius={16}>
                  <Text className="mb-3 text-sm font-medium text-lucrei-text">Produtos mais lucrativos</Text>
                  <View className="gap-2">
                    {topProfitable.map((p) => (
                      <ProductRankRow key={`${p.shopId ?? ''}-${p.shopeeItemId}`} product={p} />
                    ))}
                  </View>
                </GlassCard>
              )}

              {lossMakers.length > 0 && (
                <GlassCard className="p-4" borderRadius={16}>
                  <Text className="mb-3 text-sm font-medium text-lucrei-text">Produtos no prejuízo</Text>
                  <View className="gap-2">
                    {lossMakers.map((p) => (
                      <ProductRankRow key={`${p.shopId ?? ''}-${p.shopeeItemId}`} product={p} />
                    ))}
                  </View>
                </GlassCard>
              )}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
