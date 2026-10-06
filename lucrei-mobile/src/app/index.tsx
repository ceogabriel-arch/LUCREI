import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AchievementsCard } from '@/components/achievements-card';
import { BlurredValue } from '@/components/blurred-value';
import { HistoryBackfillCard } from '@/components/history-backfill-card';
import { MarketplaceBadge } from '@/components/marketplace-badge';
import { MissingCostList } from '@/components/missing-cost-list';
import { PastDueBanner } from '@/components/past-due-banner';
import { PendingOrdersModal } from '@/components/pending-orders-modal';
import { ProfitBreakdownDonut, RevenueRing } from '@/components/profit-donut';
import { Screen } from '@/components/screen';
import { ShopPicker } from '@/components/shop-picker';
import { Sparkline } from '@/components/sparkline';
import { StatTile } from '@/components/stat-tile';
import {
  ApiError,
  getCombinedOrderForecast,
  getCombinedSummary,
  getOrderForecast,
  getShopeeProducts,
  getSummary,
  getSyncStatus,
  startSync,
  type OrderForecast,
  type ShopeeProduct,
  type Summary,
} from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { useDataRefresh } from '@/lib/data-refresh';
import { formatBRL } from '@/lib/format';
import { PERIOD_TO_API, PERIODS, usePeriod } from '@/lib/period';
import { useIsDesktopWeb } from '@/lib/responsive';
import { connectMercadoLivreStore } from '@/lib/mercado-livre';
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
  const { shops, selectedShop, viewingAll, loaded: shopsLoaded, refresh: refreshShops } = useSelectedShop();
  const { period, setPeriod } = usePeriod();
  const { refreshSignal } = useDataRefresh();
  const subscriptionAccess = useSubscriptionAccess();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [connecting, setConnecting] = useState<'shopee' | 'mercado_livre' | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [perShopProfit, setPerShopProfit] = useState<
    { shopId: string; shopName: string; provider: 'shopee' | 'mercado_livre'; profit: number }[]
  >([]);
  const [forecast, setForecast] = useState<OrderForecast | null>(null);
  const [missingCostProducts, setMissingCostProducts] = useState<ShopeeProduct[]>([]);
  const [lifetimeProfit, setLifetimeProfit] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingOrdersOpen, setPendingOrdersOpen] = useState(false);

  async function handleConnectShopee() {
    if (state.status !== 'authenticated') return;
    setConnecting('shopee');
    try {
      const result = await connectShopeeStore(state.token);
      if (result.status === 'success') {
        showAlert('Loja conectada!', 'Sua loja Shopee foi conectada com sucesso.');
        await refreshShops();
      } else if (result.status === 'error') {
        if (result.reason === 'shop_taken') {
          showAlert(
            'Loja já conectada em outra conta',
            'Essa loja Shopee já está conectada em outra conta Lucrei. Se você esperava logar em outra loja, confira se o navegador não está logado na Shopee com a conta errada (a tela de login costuma pular esse passo sozinha) - senão, peça para desconectá-la lá (em Configurações) antes de conectar aqui.'
          );
        } else if (result.reason === 'invalid_state') {
          // Token de autorização (válido por 30min) venceu antes da pessoa
          // terminar o login/SMS da Shopee - o link inteiro precisa recomeçar,
          // não dá pra retomar de onde parou.
          showAlert(
            'O link de conexão expirou',
            'Demorou demais pra terminar o login na Shopee e o link venceu. Toque em "Conectar outra loja" e tente de novo.'
          );
        } else if (result.reason === 'exchange_failed') {
          showAlert(
            'A Shopee não respondeu a tempo',
            'Falha temporária na comunicação com a Shopee. Tente conectar de novo em instantes.'
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
      setConnecting(null);
    }
  }

  // Espelha handleConnectShopee - mesmo shape de erro/motivo, só troca o
  // texto pro Mercado Livre. Sincronização de pedido pra loja ML ainda não
  // existe (Fase 2) - conectar aqui só guarda o token, sem sincronizar nada.
  async function handleConnectMercadoLivre() {
    if (state.status !== 'authenticated') return;
    setConnecting('mercado_livre');
    try {
      const result = await connectMercadoLivreStore(state.token);
      if (result.status === 'success') {
        showAlert('Loja conectada!', 'Sua loja Mercado Livre foi conectada com sucesso.');
        await refreshShops();
      } else if (result.status === 'error') {
        if (result.reason === 'shop_taken') {
          showAlert(
            'Loja já conectada em outra conta',
            'Essa loja Mercado Livre já está conectada em outra conta Lucrei. Se você esperava logar em outra loja, confira se o navegador não está logado no Mercado Livre com a conta errada (a tela de autorização costuma pular esse passo sozinha) - senão, peça para desconectá-la lá (em Configurações) antes de conectar aqui.'
          );
        } else if (result.reason === 'invalid_state') {
          showAlert(
            'O link de conexão expirou',
            'Demorou demais pra terminar o login no Mercado Livre e o link venceu. Toque em "Conectar Mercado Livre" e tente de novo.'
          );
        } else if (result.reason === 'exchange_failed') {
          showAlert(
            'O Mercado Livre não respondeu a tempo',
            'Falha temporária na comunicação com o Mercado Livre. Tente conectar de novo em instantes.'
          );
        } else {
          showAlert('Não foi possível conectar', 'Tente novamente em instantes.');
        }
      } else if (result.status === 'cancelled') {
        showAlert('Conexão não concluída', 'A conexão com o Mercado Livre não foi concluída. Tente de novo.');
      }
    } catch (err) {
      showAlert('Erro', err instanceof ApiError ? err.message : 'Algo deu errado.');
    } finally {
      setConnecting(null);
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
    if (!token || (!viewingAll && !selectedShop)) {
      setSummary(null);
      setPerShopProfit([]);
      setSummaryLoading(false);
      return;
    }
    setSummaryLoading(true);
    try {
      if (viewingAll) {
        const activeShops = shops.filter((s) => s.status === 'active');
        const [combined, perShop] = await Promise.all([
          getCombinedSummary(token, PERIOD_TO_API[period]),
          Promise.all(
            activeShops.map((shop) =>
              getSummary(token, shop.id, PERIOD_TO_API[period]).then((s) => ({
                shopId: shop.id,
                shopName: shop.shopName,
                provider: shop.provider,
                profit: s.profit,
              }))
            )
          ),
        ]);
        setSummary(combined);
        setPerShopProfit(perShop);
      } else {
        const s = await getSummary(token, selectedShop!.id, PERIOD_TO_API[period]);
        setSummary(s);
        setPerShopProfit([]);
      }
    } catch {
      setSummary(null);
      setPerShopProfit([]);
    } finally {
      setSummaryLoading(false);
    }
  }, [token, selectedShop, period, viewingAll, shops]);

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

  // Lista por trás do "N item(ns) sem custo cadastrado" - summary só traz a
  // CONTAGEM (itemsMissingCost), então busca os produtos de verdade à parte
  // pra alimentar a lista suspensa (ver MissingCostList) com nome e onde
  // editar o custo de cada um.
  const loadMissingCostProducts = useCallback(async () => {
    if (!token || (!viewingAll && !selectedShop)) {
      setMissingCostProducts([]);
      return;
    }
    try {
      if (viewingAll) {
        const activeShops = shops.filter((s) => s.status === 'active');
        const perShop = await Promise.all(
          activeShops.map((shop) =>
            getShopeeProducts(token, shop.id, PERIOD_TO_API[period]).then((res) =>
              res.products.map((p) => ({ ...p, shopId: shop.id }))
            )
          )
        );
        setMissingCostProducts(perShop.flat().filter((p) => p.orders > 0 && p.costPrice == null));
      } else {
        const res = await getShopeeProducts(token, selectedShop!.id, PERIOD_TO_API[period]);
        setMissingCostProducts(
          res.products.filter((p) => p.orders > 0 && p.costPrice == null).map((p) => ({ ...p, shopId: selectedShop!.id }))
        );
      }
    } catch {
      setMissingCostProducts([]);
    }
  }, [token, selectedShop, period, viewingAll, shops]);

  useEffect(() => {
    loadMissingCostProducts();
  }, [loadMissingCostProducts]);

  useEffect(() => {
    if (refreshSignal > 0) loadMissingCostProducts();
  }, [refreshSignal, loadMissingCostProducts]);

  // Previsão de lucro (pedidos recém-comprados, ainda não concluídos em
  // nenhum marketplace) - estimativa separada do resumo real, não trava nem
  // depende dele. Não é filtrada por período (Hoje/7 dias/30 dias): é
  // sempre "quanto tem em aberto agora", igual o contador em si.
  const loadForecast = useCallback(async () => {
    if (!token || (!viewingAll && !selectedShop)) {
      setForecast(null);
      return;
    }
    try {
      const f = viewingAll ? await getCombinedOrderForecast(token) : await getOrderForecast(token, selectedShop!.id);
      setForecast(f);
    } catch {
      setForecast(null);
    }
  }, [token, selectedShop, viewingAll]);

  useEffect(() => {
    loadForecast();
  }, [loadForecast]);

  useEffect(() => {
    if (refreshSignal > 0) loadForecast();
  }, [refreshSignal, loadForecast]);

  // Mesmo botão de "Sincronizar agora" que já existia em Pedidos, mas
  // pedido explicitamente também pra Início - reportado ao vivo que a
  // pessoa não achava onde sincronizar sem entrar em Pedidos primeiro.
  const pollSyncUntilDone = useCallback(async () => {
    const MAX_CONSECUTIVE_FAILURES = 15;
    let consecutiveFailures = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!token || !selectedShop) break;
        let status;
        try {
          status = await getSyncStatus(token, selectedShop.id);
        } catch (err) {
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            showAlert('Não foi possível sincronizar', err instanceof ApiError ? err.message : 'Verifique sua internet e tente de novo.');
            break;
          }
          continue;
        }
        consecutiveFailures = 0;
        if (status.status === 'done') {
          await Promise.all([refreshShops(), loadSummary(), loadForecast()]);
          break;
        }
        if (status.status === 'error') {
          showAlert('Não foi possível sincronizar', status.error ?? 'Tenta de novo em instantes.');
          break;
        }
      }
    } finally {
      setSyncing(false);
    }
  }, [token, selectedShop, refreshShops, loadSummary, loadForecast]);

  useEffect(() => {
    if (!token || !selectedShop) return;
    getSyncStatus(token, selectedShop.id)
      .then((status) => {
        if (status.status === 'running') {
          setSyncing(true);
          pollSyncUntilDone();
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShop?.id]);

  async function handleSync() {
    if (!token || !selectedShop) return;
    setSyncing(true);
    try {
      await startSync(token, selectedShop.id);
    } catch (err) {
      setSyncing(false);
      showAlert('Não foi possível sincronizar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
      return;
    }
    pollSyncUntilDone();
  }

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refreshShops(), loadSummary(), loadForecast()]);
    setRefreshing(false);
  }

  // Sempre soma TODAS as lojas, independente do modo de visualização atual
  // ("Todas as lojas" ou uma loja só) - as conquistas são da conta, não da
  // loja selecionada no momento (lucrar R$100 numa loja e R$50 noutra conta
  // R$150 pra desbloquear um patamar, não fica separado por loja).
  useEffect(() => {
    if (state.status !== 'authenticated') {
      setLifetimeProfit(null);
      return;
    }
    getCombinedSummary(state.token, 'all')
      .then((s) => setLifetimeProfit(s.profit))
      .catch(() => setLifetimeProfit(null));
  }, [state.status, token, shops.length]);

  // Só loja ATIVA conta - com uma loja só desconectada, "hasShop" contando
  // qualquer status fazia esse trecho achar que tinha loja de verdade
  // (escondia o estado vazio de "conecte sua loja", e quebrava a asserção
  // selectedShop! mais abaixo, já que selectedShop nunca aponta pra uma
  // desconectada).
  const hasShop = shops.some((s) => s.status === 'active');
  const showingRealData = hasShop && summary !== null;
  const stillLoading = !shopsLoaded || (hasShop && summaryLoading && summary === null);

  // A sincronização automática (dispara sozinha ao conectar) pode ainda
  // estar rodando quando o resumo já veio zerado do banco - sem isso, loja
  // recém-conectada mostra "Você lucrou R$ 0,00" cru, parecendo que deu
  // errado, quando na real só falta terminar de puxar os pedidos.
  const syncingNow = viewingAll
    ? shops.some((s) => s.status === 'active' && s.syncStatus === 'running')
    : selectedShop?.syncStatus === 'running';

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

  // "Shopee" só faz sentido nesse texto quando a loja selecionada é
  // realmente uma Shopee - com "Todas as lojas" (mistura de marketplaces)
  // ou uma loja Mercado Livre selecionada, nomear a marketplace errada
  // era confuso (reportado ao vivo: "que líquido da Shopee ele vai fazer
  // se ele é Mercado Livre?").
  const marketplaceLabel = viewingAll ? 'Marketplace' : selectedShop?.provider === 'mercado_livre' ? 'Mercado Livre' : 'Shopee';
  const marketplaceLabelLower = viewingAll ? 'do marketplace' : selectedShop?.provider === 'mercado_livre' ? 'do Mercado Livre' : 'da Shopee';

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
          helpText: `Soma de tudo que sai do seu bolso no período: custo do produto, frete líquido e taxas ${marketplaceLabelLower}.`,
        },
        {
          label: `Líquido ${marketplaceLabel}`,
          value: formatBRL(summary!.revenue - summary!.shopeeFees),
          helpText: `Faturamento menos as taxas cobradas ${marketplaceLabelLower}. Ainda não desconta o custo do produto nem o frete.`,
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

        <View className="mt-7 flex-row items-center justify-between gap-2">
          <View className="flex-row items-center gap-2">
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

          {/* Botão pequeno demais no cabeçalho passava despercebido
              (reportado ao vivo) - agora é um pill dourado com texto, bem
              mais chamativo, do lado do seletor de período onde a pessoa já
              está olhando pra conferir se o dado tá atualizado. */}
          {!viewingAll && selectedShop && (
            <Pressable
              onPress={handleSync}
              disabled={syncing}
              className="flex-row items-center gap-1.5 rounded-full px-3.5 py-2"
              style={{ backgroundColor: Colors.gold, opacity: syncing ? 0.6 : 1 }}>
              {syncing ? (
                <ActivityIndicator size="small" color={Colors.onGold} />
              ) : (
                <Ionicons name="sync" size={14} color={Colors.onGold} />
              )}
              <Text className="text-xs font-semibold" style={{ color: Colors.onGold }}>
                {syncing ? 'Sincronizando...' : 'Sincronizar'}
              </Text>
            </Pressable>
          )}
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
                  ) : syncingNow && summary!.ordersCount === 0 ? (
                    <View className="mt-3 flex-row items-center gap-2">
                      <ActivityIndicator size="small" color={Colors.gold} />
                      <Text className="text-base font-medium text-lucrei-textMuted">Buscando seus pedidos recentes...</Text>
                    </View>
                  ) : (
                    <Text className={isDesktop ? 'mt-1 text-6xl font-bold text-lucrei-gold' : 'mt-1 text-5xl font-bold text-lucrei-gold'}>
                      {formatBRL(summary!.profit)}
                    </Text>
                  )}
                  {!stillLoading && summary!.itemsMissingCost > 0 && token && (
                    <MissingCostList
                      token={token}
                      items={missingCostProducts as (ShopeeProduct & { shopId: string })[]}
                      onSaved={() => {
                        loadSummary();
                        loadMissingCostProducts();
                      }}
                    />
                  )}

                  {!stillLoading && !isDesktop && (
                    <View className="mt-5">
                      <Sparkline data={summary!.trend.map((t) => t.profit)} />
                    </View>
                  )}

                  {/* Anel "pra onde foi o dinheiro" ao lado do lucro, estilo
                      UpSeller - pedido explicitamente pelo usuário. No celular
                      fica empilhado abaixo do sparkline por falta de espaço. */}
                  {!stillLoading && !isDesktop && summary && (
                    <View className="mt-5 flex-row items-center justify-center gap-4">
                      <RevenueRing revenue={summary.revenue} size={84} strokeWidth={12} />
                      <ProfitBreakdownDonut summary={summary} size={84} strokeWidth={12} />
                    </View>
                  )}
                </View>

                {!stillLoading && isDesktop && (
                  <View className="flex-row items-center gap-6">
                    {summary && (
                      <>
                        <RevenueRing revenue={summary.revenue} size={84} strokeWidth={13} />
                        <ProfitBreakdownDonut summary={summary} size={84} strokeWidth={13} />
                      </>
                    )}
                    <Sparkline data={summary!.trend.map((t) => t.profit)} width={260} height={110} />
                  </View>
                )}
              </View>
            </View>

            <PastDueBanner />

            {/* Conectar a loja só traz pedido novo daqui pra frente - sem
                isso, muita gente achava que o Lucrei "não estava puxando os
                pedidos antigos" e não sabia que existia um botão pra isso
                (reportado ao vivo, o botão só existia escondido lá em
                Relatórios). Só pra loja selecionada de verdade (não "Todas
                as lojas") e só Shopee (ML ainda não sincroniza pedido) -
                some sozinho depois que o histórico já foi puxado uma vez. */}
            {token && !viewingAll && selectedShop && selectedShop.provider !== 'mercado_livre' && selectedShop.historyBackfillStatus !== 'done' && (
              <View className="mt-4">
                <HistoryBackfillCard
                  token={token}
                  shopId={selectedShop.id}
                  prominent
                  onSynced={() => {
                    refreshShops();
                    loadSummary();
                  }}
                />
              </View>
            )}

            <Text className="mt-6 text-sm font-medium text-lucrei-textMuted">Resumo do período</Text>
            {isDesktop ? (
              // Grid de 3 colunas de verdade (não flex-wrap com largura fixa)
              // pra ocupar a largura do desktop de forma proporcional, em vez
              // de ficar pequeno e encostado à esquerda.
              <View
                className="mt-3"
                // display:'grid' só existe no RN Web (é sempre isDesktop, ou
                // seja sempre web) - o tipo ViewStyle do RN não conhece essa
                // propriedade, daí o "as any" só nesse objeto de estilo.
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 } as any}>
                {!stillLoading &&
                  kpiTiles.map((kpi) => (
                    <StatTile key={kpi.label} {...kpi} blurred={subscriptionAccess.isPastDue} large />
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

            {/* Estimativa, separada do lucro real acima - pedido comprado na
                Shopee mas ainda em processamento, taxa/frete exatos só saem
                quando ele completa de verdade. Só aparece com algo pra
                mostrar, pra não virar um card vazio "0 pedidos". */}
            {!stillLoading && forecast !== null && forecast.pendingCount > 0 && (
              <Pressable
                onPress={() => setPendingOrdersOpen(true)}
                hitSlop={4}
                style={({ pressed }) => [
                  { borderColor: Colors.goldDim, backgroundColor: Colors.surfaceAlt, opacity: pressed ? 0.7 : 1 },
                ]}
                className="mt-3 flex-row items-center justify-between rounded-2xl border border-dashed p-4">
                <View className="flex-1 pr-3">
                  <Text className="text-sm font-medium text-lucrei-text">Previsão de lucro (estimado)</Text>
                  <Text className="mt-0.5 text-xs text-lucrei-textMuted">
                    {forecast.pendingCount} {forecast.pendingCount === 1 ? 'pedido comprado' : 'pedidos comprados'}{' '}
                    ainda em processamento. Toque pra ver.
                  </Text>
                </View>
                {subscriptionAccess.isPastDue ? (
                  <BlurredValue width={70} />
                ) : (
                  <Text className="text-lg font-bold" style={{ color: Colors.goldDim }}>
                    {formatBRL(forecast.projectedProfit)}
                  </Text>
                )}
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} style={{ marginLeft: 6 }} />
              </Pressable>
            )}

            <PendingOrdersModal
              visible={pendingOrdersOpen}
              onClose={() => setPendingOrdersOpen(false)}
              token={token}
              shopId={viewingAll ? null : (selectedShop?.id ?? null)}
            />

            {/* Só faz sentido com "Todas as lojas" e 2+ lojas - com uma loja
                só, o card acima já mostra o lucro dela, repetir aqui seria
                redundante. */}
            {!stillLoading && viewingAll && perShopProfit.length > 1 && (
              <View className="mt-3 gap-2">
                <Text className="text-sm font-medium text-lucrei-textMuted">Lucro por loja</Text>
                {perShopProfit.map((shop) => (
                  <View
                    key={shop.shopId}
                    className="flex-row items-center justify-between rounded-2xl border border-lucrei-border bg-lucrei-surface p-3.5">
                    <View className="flex-row items-center gap-3">
                      <MarketplaceBadge provider={shop.provider} />
                      <Text className="text-sm text-lucrei-text" numberOfLines={1}>
                        {shop.shopName}
                      </Text>
                    </View>
                    {subscriptionAccess.isPastDue ? (
                      <BlurredValue width={70} />
                    ) : (
                      <Text
                        className="text-sm font-bold"
                        style={{ color: shop.profit >= 0 ? Colors.gold : Colors.danger }}>
                        {formatBRL(shop.profit)}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
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
              Conecte sua loja Shopee ou Mercado Livre pra ver seu lucro real aqui
            </Text>
            <Text className="mt-1 max-w-xs text-center text-sm text-lucrei-textMuted">
              Faturamento, custos e lucro de cada venda aparecem automaticamente assim que você conectar.
            </Text>
          </View>
        )}

        {/* No desktop largo, Conquistas já mora fixa na barra lateral (ver
            DesktopShell) - manter aqui também seria duplicado. */}
        {!isDesktop && state.status === 'authenticated' && hasShop && lifetimeProfit !== null && (
          <AchievementsCard totalProfit={lifetimeProfit} accountCreatedAt={state.user.createdAt} />
        )}

        <View className="mt-8 flex-row gap-2.5 self-center" style={{ width: isDesktop ? 360 : '100%' }}>
          <Pressable
            onPress={handleConnectShopee}
            disabled={connecting !== null}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-lucrei-gold py-4"
            style={{ opacity: connecting !== null ? 0.7 : 1 }}>
            {connecting === 'shopee' ? (
              <ActivityIndicator color={Colors.onGold} />
            ) : (
              <Ionicons name="storefront-outline" size={18} color={Colors.onGold} />
            )}
            <Text className="text-base font-semibold text-lucrei-onGold" numberOfLines={1}>
              {connecting === 'shopee' ? 'Conectando...' : 'Shopee'}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleConnectMercadoLivre}
            disabled={connecting !== null}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-lucrei-gold py-4"
            style={{ opacity: connecting !== null ? 0.7 : 1 }}>
            {connecting === 'mercado_livre' ? (
              <ActivityIndicator color={Colors.onGold} />
            ) : (
              <Ionicons name="storefront-outline" size={18} color={Colors.onGold} />
            )}
            <Text className="text-base font-semibold text-lucrei-onGold" numberOfLines={1}>
              {connecting === 'mercado_livre' ? 'Conectando...' : 'Mercado Livre'}
            </Text>
          </Pressable>
        </View>
        <Text className="mt-2 text-center text-xs text-lucrei-textMuted">
          {hasShop ? 'Conectar outra loja' : 'Conecte sua loja'}
        </Text>
        {!stillLoading && (
          <Text className="mt-3 text-center text-xs text-lucrei-textMuted">
            {(() => {
              // selectedShop só é lido DENTRO de showingRealData/hasShop -
              // os dois só são true quando existe loja ativa de verdade
              // (ver comentário acima de hasShop). Calcular shopLabel antes
              // dessa checagem quebrava com "Cannot read properties of
              // null" pra quem não tem nenhuma loja ativa (só uma
              // desconectada, por exemplo) - selectedShop!.shopName rodava
              // mesmo indo cair no fallback "conecte sua loja" logo depois.
              if (showingRealData) {
                const shopLabel = viewingAll ? 'Todas as lojas' : selectedShop!.shopName;
                return `Loja conectada: ${shopLabel}.`;
              }
              if (hasShop) {
                const shopLabel = viewingAll ? 'Todas as lojas' : selectedShop!.shopName;
                return `Loja conectada: ${shopLabel}. Ainda sem pedidos sincronizados nesse período.`;
              }
              return 'Os números acima são um exemplo. Conecte sua loja para ver o seu lucro real.';
            })()}
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}
