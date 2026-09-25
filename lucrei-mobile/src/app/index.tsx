import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AchievementsCard } from '@/components/achievements-card';
import { BlurredValue } from '@/components/blurred-value';
import { PastDueBanner } from '@/components/past-due-banner';
import { Screen } from '@/components/screen';
import { ShopPicker } from '@/components/shop-picker';
import { Sparkline } from '@/components/sparkline';
import { StatTile } from '@/components/stat-tile';
import { ApiError, getSummary, type Summary } from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { useDataRefresh } from '@/lib/data-refresh';
import { formatBRL } from '@/lib/format';
import { PERIOD_TO_API, PERIODS, usePeriod } from '@/lib/period';
import { useIsDesktopWeb } from '@/lib/responsive';
import { useSelectedShop } from '@/lib/selected-shop';
import { connectShopeeStore } from '@/lib/shopee';
import { useSubscriptionAccess } from '@/lib/subscription-access';
import { useAppTheme } from '@/lib/theme';

const LOGO_LIGHT = require('../../assets/images/lucrei-logo-light.png');
const LOGO_DARK = require('../../assets/images/lucrei-logo.png');

type BackendStatus = 'checking' | 'online' | 'offline';

const LOGO_ASPECT = 449 / 153;
const LOGO_HEIGHT = 30;
const LOGO_WIDTH = LOGO_HEIGHT * LOGO_ASPECT;

export default function InicioScreen() {
  const { state, refreshUser } = useAuth();
  const router = useRouter();
  const { scheme, colors: Colors } = useAppTheme();
  const isDesktop = useIsDesktopWeb();
  const { shops, selectedShop, loaded: shopsLoaded, refresh: refreshShops } = useSelectedShop();
  const { period, setPeriod } = usePeriod();
  const { refreshSignal } = useDataRefresh();
  const subscriptionAccess = useSubscriptionAccess();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [connecting, setConnecting] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [lifetimeProfit, setLifetimeProfit] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function handleConnectShopee() {
    if (state.status !== 'authenticated') return;
    setConnecting(true);
    try {
      const result = await connectShopeeStore(state.token);
      if (result.status === 'success') {
        showAlert('Loja conectada!', 'Sua loja Shopee foi conectada com sucesso.');
        await refreshShops();
      } else if (result.status === 'error') {
        if (result.reason === 'shop_taken') {
          showAlert(
            'Loja já conectada em outra conta',
            'Essa loja Shopee já está conectada em outra conta Lucrei. Peça para desconectá-la lá (em Configurações) antes de conectar aqui.'
          );
        } else {
          showAlert('Não foi possível conectar', 'Tente novamente em instantes.');
        }
      } else if (result.status === 'cancelled') {
        // Cobre tanto quem fechou a tela de propósito quanto o caso real de
        // travar em "Please login first" na própria página da Shopee - os
        // dois chegam como 'cancelled' aqui (não dá pra distinguir, já que
        // nenhum dos dois volta pro nosso callback), então a mensagem cobre
        // ambos sem soar como erro forçado.
        showAlert(
          'Conexão não concluída',
          'Se a Shopee ficou travada pedindo login, faça login direto em shopee.com.br pelo navegador antes de conectar, ou tente por outro navegador/computador.'
        );
      }
    } catch (err) {
      showAlert('Erro', err instanceof ApiError ? err.message : 'Algo deu errado.');
    } finally {
      setConnecting(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      refreshShops();
      refreshUser();
    }, [refreshShops, refreshUser])
  );

  // Token em vez do objeto "state" inteiro: refreshUser() troca "state" por
  // um objeto novo a cada chamada (mesmo com os mesmos dados) - depender
  // dele aqui fazia o resumo ser recalculado de novo toda vez que a tela
  // ganhava foco, mesmo sem nada ter mudado de verdade.
  const token = state.status === 'authenticated' ? state.token : null;

  const loadSummary = useCallback(async () => {
    if (!token || !selectedShop) {
      setSummary(null);
      setSummaryLoading(false);
      return;
    }
    setSummaryLoading(true);
    try {
      const s = await getSummary(token, selectedShop.id, PERIOD_TO_API[period]);
      setSummary(s);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [token, selectedShop, period]);

  useEffect(() => {
    setSummary(null);
    loadSummary();
  }, [loadSummary]);

  // Pedido concluído chegando via push (ver DataRefreshProvider em
  // _layout.tsx) - recarrega o resumo sozinho, sem esperar o usuário puxar
  // pra atualizar ou trocar de tela. refreshSignal > 0 evita recarregar de
  // novo no mount (o efeito acima já cobre isso).
  useEffect(() => {
    if (refreshSignal > 0) loadSummary();
  }, [refreshSignal, loadSummary]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refreshShops(), loadSummary()]);
    setRefreshing(false);
  }

  useEffect(() => {
    if (state.status !== 'authenticated' || !selectedShop) {
      setLifetimeProfit(null);
      return;
    }
    getSummary(state.token, selectedShop.id, 'all')
      .then((s) => setLifetimeProfit(s.profit))
      .catch(() => setLifetimeProfit(null));
  }, [state.status, selectedShop]);

  const hasShop = shops.length > 0;
  const showingRealData = hasShop && summary !== null;
  const stillLoading = !shopsLoaded || (hasShop && summaryLoading && summary === null);

  const salesLimit = state.status === 'authenticated' ? state.user.plan?.salesLimit ?? null : null;
  const salesUsed = state.status === 'authenticated' ? state.user.salesUsedThisMonth ?? null : null;
  const salesUsageRatio = salesLimit && salesUsed !== null ? salesUsed / salesLimit : null;
  const showSalesLimitWarning = salesUsageRatio !== null && salesUsageRatio >= 0.8;

  const trialDaysLeft =
    state.status === 'authenticated' && state.user.subscriptionStatus === 'trialing' && state.user.trialEndsAt
      ? // floor, não ceil - com 29h restantes (1 dia e uns 5h) o usuário espera
        // ver "1 dia", não "2 dias" só porque sobrou uma fração de dia a mais.
        Math.floor((new Date(state.user.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      : null;
  const showTrialCard = trialDaysLeft !== null && trialDaysLeft >= 0;
  // Verde enquanto sobra bastante teste, dourado quando começa a apertar,
  // vermelho pertinho do fim - mesmos limiares que o resto do app já usa
  // pra "quase no limite" (>=80% de 15 dias ~ 3 dias restantes).
  const trialColor =
    trialDaysLeft === null ? Colors.success : trialDaysLeft <= 3 ? Colors.danger : trialDaysLeft <= 7 ? Colors.gold : Colors.success;

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

  const kpiTiles = showingRealData
    ? [
        {
          label: 'Faturamento',
          value: formatBRL(summary!.revenue),
          helpText: 'Soma do valor de venda de todos os pedidos do período, sem descontar nada.',
        },
        {
          label: 'Custos totais',
          value: formatBRL(summary!.cost),
          positiveIsGood: false,
          helpText: 'Soma de tudo que sai do seu bolso no período: custo do produto, frete líquido e taxas da Shopee.',
        },
        {
          label: 'Líquido Shopee',
          value: formatBRL(summary!.revenue - summary!.shopeeFees),
          helpText: 'Faturamento menos as taxas cobradas pela Shopee. Ainda não desconta o custo do produto nem o frete.',
        },
        {
          label: 'Pedidos',
          value: String(summary!.ordersCount),
          helpText: 'Quantidade de pedidos concluídos no período selecionado.',
        },
        {
          label: 'Ticket médio',
          value: formatBRL(summary!.avgTicket),
          helpText: 'Faturamento do período dividido pela quantidade de pedidos.',
        },
        {
          label: 'Margem de lucro',
          value: `${summary!.profitMargin.toFixed(1)}%`,
          helpText:
            'Lucro dividido pelo faturamento dos pedidos com custo cadastrado, em porcentagem. Pedido sem custo cadastrado não entra nessa conta.',
        },
      ]
    : [];

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-8"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.gold} />
        }>
        <View className="flex-row items-center justify-between">
          <View>
            <Image
              source={scheme === 'dark' ? LOGO_DARK : LOGO_LIGHT}
              style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT }}
              contentFit="contain"
            />
            <ShopPicker />
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

        {showSalesLimitWarning && (
          <Pressable
            onPress={() => router.push('/planos')}
            className="mt-4 flex-row items-center gap-3 rounded-2xl border border-lucrei-gold bg-lucrei-surface p-4">
            <Ionicons name="warning-outline" size={20} color={Colors.gold} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-lucrei-text">
                {salesUsed} de {salesLimit} vendas usadas esse mês
              </Text>
              <Text className="mt-0.5 text-xs text-lucrei-textMuted">
                Você está perto do limite do seu plano. Toque para ver planos maiores.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </Pressable>
        )}

        {showTrialCard && (
          <Pressable
            onPress={() => router.push('/planos')}
            className="mt-4 flex-row items-center gap-3 rounded-2xl border bg-lucrei-surface p-4"
            style={{ borderColor: trialColor }}>
            <Ionicons name="hourglass-outline" size={20} color={trialColor} />
            <View className="flex-1">
              <Text className="text-sm font-semibold" style={{ color: trialColor }}>
                {trialDaysLeft === 0
                  ? 'Seu teste grátis termina hoje'
                  : trialDaysLeft === 1
                    ? 'Seu teste grátis termina amanhã'
                    : `Faltam ${trialDaysLeft} dias do seu teste grátis`}
              </Text>
              <Text className="mt-0.5 text-xs text-lucrei-textMuted">
                {trialDaysLeft !== null && trialDaysLeft <= 3
                  ? 'Escolha um plano pra não perder o acesso ao Lucrei.'
                  : 'Aproveite pra conhecer o Lucrei antes de escolher um plano.'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
          </Pressable>
        )}

        <View className="mt-7 flex-row items-center gap-2">
          <View className="flex-row self-start rounded-full bg-lucrei-surface p-1">
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
                    style={{ color: active ? Colors.onGold : Colors.textMuted }}>
                    {p}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!stillLoading && summaryLoading && <ActivityIndicator size="small" color={Colors.gold} />}
        </View>

        {stillLoading || showingRealData ? (
          <>
            <View className="mt-4 overflow-hidden rounded-3xl border border-lucrei-border">
              <LinearGradient
                colors={[Colors.surfaceAlt, Colors.surface]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View className={isDesktop ? 'flex-row items-center justify-between p-8' : 'p-6'}>
                <View className={isDesktop ? 'flex-1' : undefined}>
                  <View className="flex-row items-center gap-2">
                    <Text className="text-sm text-lucrei-textMuted">Você lucrou</Text>
                    {!stillLoading && summaryLoading && <ActivityIndicator size="small" color={Colors.textMuted} />}
                  </View>
                  {stillLoading ? (
                    <View className="mt-3 h-[52px] justify-center">
                      <ActivityIndicator color={Colors.gold} />
                    </View>
                  ) : subscriptionAccess.isPastDue ? (
                    <View className="mt-3">
                      <BlurredValue width={180} height={isDesktop ? 52 : 44} />
                    </View>
                  ) : (
                    <Text className={isDesktop ? 'mt-1 text-6xl font-bold text-lucrei-gold' : 'mt-1 text-5xl font-bold text-lucrei-gold'}>
                      {formatBRL(summary!.profit)}
                    </Text>
                  )}
                  {!stillLoading && summary!.itemsMissingCost > 0 && (
                    <Text className="mt-2 text-xs text-lucrei-textMuted">
                      {summary!.itemsMissingCost} item(ns) sem custo cadastrado, não entram nesse total.
                    </Text>
                  )}

                  {!stillLoading && !isDesktop && (
                    <View className="mt-5">
                      <Sparkline data={summary!.trend.map((t) => t.profit)} />
                    </View>
                  )}
                </View>

                {!stillLoading && isDesktop && (
                  <Sparkline data={summary!.trend.map((t) => t.profit)} width={380} height={110} />
                )}
              </View>
            </View>

            <PastDueBanner />

            <Text className="mt-6 text-sm font-medium text-lucrei-textMuted">Resumo do período</Text>
            {isDesktop ? (
              <View className="mt-3 flex-row flex-wrap gap-3">
                {!stillLoading &&
                  kpiTiles.map((kpi) => (
                    <StatTile key={kpi.label} {...kpi} blurred={subscriptionAccess.isPastDue} />
                  ))}
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="-mx-5 mt-3"
                contentContainerClassName="gap-3 px-5">
                {!stillLoading &&
                  kpiTiles.map((kpi) => (
                    <StatTile key={kpi.label} {...kpi} blurred={subscriptionAccess.isPastDue} />
                  ))}
              </ScrollView>
            )}
          </>
        ) : (
          // Sem loja conectada ainda - antes mostrava um período/lucro/KPIs
          // de exemplo com números inventados (ex: "R$ 40.250,00"), o que
          // dava a entender que era algo real. Um estado vazio simples é
          // mais honesto e já deixa claro o que fazer a seguir.
          <View className="mt-6 items-center rounded-3xl border border-lucrei-border bg-lucrei-surface px-6 py-12">
            <Ionicons name="storefront-outline" size={32} color={Colors.textMuted} />
            <Text className="mt-3 text-center text-base font-semibold text-lucrei-text">
              Conecte sua loja Shopee pra ver seu lucro real aqui
            </Text>
            <Text className="mt-1 max-w-xs text-center text-sm text-lucrei-textMuted">
              Faturamento, custos e lucro de cada venda aparecem automaticamente assim que você conectar.
            </Text>
          </View>
        )}

        {state.status === 'authenticated' && hasShop && lifetimeProfit !== null && (
          <AchievementsCard totalProfit={lifetimeProfit} accountCreatedAt={state.user.createdAt} />
        )}

        <Pressable
          onPress={handleConnectShopee}
          disabled={connecting}
          className="mt-8 flex-row items-center justify-center gap-2 self-center rounded-2xl bg-lucrei-gold py-4"
          style={{ opacity: connecting ? 0.7 : 1, width: isDesktop ? 360 : '100%' }}>
          {connecting ? (
            <ActivityIndicator color={Colors.onGold} />
          ) : (
            <Ionicons name="storefront-outline" size={18} color={Colors.onGold} />
          )}
          <Text className="text-base font-semibold text-lucrei-onGold">
            {connecting ? 'Conectando...' : hasShop ? 'Conectar outra loja' : 'Conectar loja Shopee'}
          </Text>
        </Pressable>
        {!stillLoading && (
          <Text className="mt-3 text-center text-xs text-lucrei-textMuted">
            {showingRealData
              ? `Loja conectada: ${selectedShop!.shopName}.`
              : hasShop
                ? `Loja conectada: ${selectedShop!.shopName}. Ainda sem pedidos sincronizados nesse período.`
                : 'Os números acima são um exemplo. Conecte sua loja para ver o seu lucro real.'}
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}
