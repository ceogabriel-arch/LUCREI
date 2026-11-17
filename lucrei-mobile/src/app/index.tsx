import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { AchievementsCard } from '@/components/achievements-card';
import { AnnouncementsBanner } from '@/components/announcements-banner';
import { BlurredValue } from '@/components/blurred-value';
import { ConnectMarketplaceMenu } from '@/components/connect-marketplace-menu';
import { GlassCard } from '@/components/glass-card';
import { HistoryBackfillCard, supportsHistoryBackfill } from '@/components/history-backfill-card';
import { IfoodConnectModal } from '@/components/ifood-connect-modal';
import { MarketplaceBadge } from '@/components/marketplace-badge';
import { MissingCostList } from '@/components/missing-cost-list';
import { PastDueBanner } from '@/components/past-due-banner';
import { PendingOrdersModal } from '@/components/pending-orders-modal';
import { ProfitBreakdownDonut, RevenueRing } from '@/components/profit-donut';
import { Screen } from '@/components/screen';
import { ShopPicker } from '@/components/shop-picker';
import { Sparkline } from '@/components/sparkline';
import { StatTile } from '@/components/stat-tile';
import { UsageBar } from '@/components/usage-bar';
import {
  ApiError,
  getCombinedOrderForecast,
  getCombinedSummary,
  getOrderForecast,
  getSalesUsage,
  getShopeeProducts,
  getSummary,
  getSyncStatus,
  startSync,
  type OrderForecast,
  type SalesUsage,
  type ShopeeProduct,
  type Summary,
} from '@/lib/api';
import { showAlert } from '@/lib/alert';
import { useAuth } from '@/lib/auth';
import { useDataRefresh } from '@/lib/data-refresh';
import { formatBRL } from '@/lib/format';
import { MARKETPLACE_LABELS_LOWER, marketplaceLabel, type Marketplace } from '@/lib/marketplace';
import { PERIOD_TO_API, PERIODS, type PeriodLabel, usePeriod } from '@/lib/period';
import { useIsDesktopWeb, webCapWidth } from '@/lib/responsive';
import { connectMercadoLivreStore } from '@/lib/mercado-livre';
import { useSelectedShop } from '@/lib/selected-shop';
import { connectShopeeStore } from '@/lib/shopee';
import { connectTiktokShopStore } from '@/lib/tiktok-shop';
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
  const { refreshSignal, triggerRefresh } = useDataRefresh();
  const subscriptionAccess = useSubscriptionAccess();
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [connecting, setConnecting] = useState<'shopee' | 'mercado_livre' | 'ifood' | 'tiktok_shop' | null>(null);
  const [ifoodModalVisible, setIfoodModalVisible] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  // Qual período o "summary" guardado acima pertence de verdade - achado ao
  // vivo: trocar de "Hoje" pra "30 dias" pintava o botão novo na hora, mas
  // os números de "Hoje" ficavam piscando até a troca real de período
  // (efeito separado, roda só depois desse 1º paint) limpar e buscar de
  // novo. Comparar contra "period" direto no render (sem esperar um efeito)
  // evita esse flash.
  const [summaryPeriod, setSummaryPeriod] = useState<PeriodLabel | null>(null);
  const summaryRequestIdRef = useRef(0);
  const [summaryLoading, setSummaryLoading] = useState(true);
  // Falha ao buscar o resumo deixava summary=null e caía no estado vazio de
  // "Conecte sua loja" (com o rodapé dizendo "Loja conectada: X" ao mesmo
  // tempo) - parecia que a loja tinha sumido. Erro de verdade agora tem
  // estado próprio, com "Tentar de novo", igual Pedidos/Relatórios.
  const [summaryError, setSummaryError] = useState(false);
  const [perShopProfit, setPerShopProfit] = useState<
    { shopId: string; shopName: string; provider: Marketplace; profit: number }[]
  >([]);
  const [forecast, setForecast] = useState<OrderForecast | null>(null);
  const [missingCostProducts, setMissingCostProducts] = useState<ShopeeProduct[]>([]);
  const [lifetimeProfit, setLifetimeProfit] = useState<number | null>(null);
  const [usage, setUsage] = useState<SalesUsage | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Guarda QUAL loja está sincronizando (não só true/false) - trocar de
  // loja no meio de um sync não pode deixar o botão da loja nova preso em
  // "Sincronizando..." (nem apagar o da loja certa ao voltar).
  const [syncingShopId, setSyncingShopId] = useState<string | null>(null);
  const syncing = syncingShopId !== null && syncingShopId === selectedShop?.id;
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
            'Demorou demais pra terminar o login na Shopee e o link venceu. Toque em "Conectar marketplace" e tente de novo.'
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
          'Dificuldade para conectar',
          'Se a janela da Shopee travou ou fechou sem conectar, veja o passo a passo de como conectar.',
          [
            {
              text: 'Ver como conectar',
              onPress: () => Linking.openURL(`${process.env.EXPO_PUBLIC_API_URL}/como-conectar-shopee`),
            },
            { text: 'OK', style: 'cancel' },
          ]
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
            'Demorou demais pra terminar o login no Mercado Livre e o link venceu. Toque em "Conectar marketplace" e tente de novo.'
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

  // Espelha handleConnectMercadoLivre - mesmo fluxo de redirecionamento e
  // mesmo shape de erro/motivo, só troca o texto pro TikTok Shop.
  async function handleConnectTiktokShop() {
    if (state.status !== 'authenticated') return;
    setConnecting('tiktok_shop');
    try {
      const result = await connectTiktokShopStore(state.token);
      if (result.status === 'success') {
        showAlert('Loja conectada!', 'Sua loja TikTok Shop foi conectada com sucesso.');
        await refreshShops();
      } else if (result.status === 'error') {
        if (result.reason === 'shop_taken') {
          showAlert(
            'Loja já conectada em outra conta',
            'Essa loja TikTok Shop já está conectada em outra conta Lucrei. Peça para desconectá-la lá (em Configurações) antes de conectar aqui.'
          );
        } else if (result.reason === 'invalid_state') {
          showAlert(
            'O link de conexão expirou',
            'Demorou demais pra terminar a autorização no TikTok Shop e o link venceu. Toque em "Conectar marketplace" e tente de novo.'
          );
        } else if (result.reason === 'exchange_failed') {
          showAlert(
            'O TikTok Shop não respondeu a tempo',
            'Falha temporária na comunicação com o TikTok Shop. Tente conectar de novo em instantes.'
          );
        } else if (result.reason === 'no_shop') {
          showAlert(
            'Nenhuma loja encontrada',
            'Essa autorização não liberou nenhuma loja TikTok Shop. Confira se você está logado na conta de vendedor certa.'
          );
        } else if (result.reason === 'denied') {
          showAlert('Autorização recusada', 'A autorização foi recusada na tela do TikTok Shop. Toque em "Conectar marketplace" pra tentar de novo.');
        } else {
          showAlert('Não foi possível conectar', 'Tente novamente em instantes.');
        }
      } else if (result.status === 'cancelled') {
        showAlert('Conexão não concluída', 'A conexão com o TikTok Shop não foi concluída. Tente de novo.');
      }
    } catch (err) {
      showAlert('Erro', err instanceof ApiError ? err.message : 'Algo deu errado.');
    } finally {
      setConnecting(null);
    }
  }

  // A iFood vincula por código (ver IfoodConnectModal), não por
  // redirecionamento - os erros já aparecem dentro do próprio modal.
  function handleConnectIfood() {
    if (state.status !== 'authenticated') return;
    setIfoodModalVisible(true);
  }

  async function handleIfoodConnected(shopName: string) {
    setIfoodModalVisible(false);
    showAlert('Loja conectada!', `Sua loja iFood "${shopName}" foi conectada com sucesso.`);
    await refreshShops();
  }

  useFocusEffect(
    useCallback(() => {
      refreshShops();
      refreshUser();
      // Notificação de pedido novo só atualiza o resumo sozinha quando o
      // app já estava aberto na hora que ela chegou (addNotificationReceivedListener
      // só dispara em primeiro plano, ver _layout.tsx) - reabrir o app
      // depois de várias notificações em segundo plano deixava o resumo
      // parado até alguém tocar em "Sincronizar". Reaproveita o mesmo sinal
      // de refresh que a notificação já usa, só que disparado também ao
      // reabrir/voltar pra essa tela.
      triggerRefresh();
    }, [refreshShops, refreshUser, triggerRefresh])
  );

  // Token em vez do objeto "state" inteiro: refreshUser() troca "state" por
  // um objeto novo a cada chamada (mesmo com os mesmos dados) - depender
  // dele aqui fazia o resumo ser recalculado de novo toda vez que a tela
  // ganhava foco, mesmo sem nada ter mudado de verdade.
  const token = state.status === 'authenticated' ? state.token : null;

  const loadSummary = useCallback(async () => {
    // Achado ao vivo: trocar de período rápido (ou uma resposta antiga
    // simplesmente demorar mais que a nova) deixava uma busca velha
    // terminar DEPOIS da nova e sobrescrever o resultado certo com o
    // errado - o número ficava "piscando" entre os dois períodos conforme
    // cada resposta chegava fora de ordem. Só a busca mais recente (esse id)
    // tem permissão de gravar no estado quando termina.
    const requestId = ++summaryRequestIdRef.current;
    const isStale = () => summaryRequestIdRef.current !== requestId;

    if (!token || (!viewingAll && !selectedShop)) {
      setSummary(null);
      setSummaryPeriod(null);
      setPerShopProfit([]);
      setUsage(null);
      setSummaryError(false);
      setSummaryLoading(false);
      return;
    }
    setSummaryLoading(true);
    try {
      if (viewingAll) {
        const activeShops = shops.filter((s) => s.status === 'active');
        // allSettled no lucro por loja: uma loja só com problema (token
        // vencido, marketplace fora do ar) derrubava o Promise.all inteiro e
        // escondia o resumo combinado de TODAS as lojas. Loja que falhou só
        // fica de fora da lista "Lucro por loja".
        const [combined, perShopResults, salesUsage] = await Promise.all([
          getCombinedSummary(token, PERIOD_TO_API[period]),
          Promise.allSettled(
            activeShops.map((shop) =>
              getSummary(token, shop.id, PERIOD_TO_API[period]).then((s) => ({
                shopId: shop.id,
                shopName: shop.shopName,
                provider: shop.provider,
                profit: s.profit,
              }))
            )
          ),
          getSalesUsage(token),
        ]);
        if (isStale()) return;
        const perShop = perShopResults.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        setSummary(combined);
        setSummaryPeriod(period);
        setPerShopProfit(perShop);
        setUsage(salesUsage);
        setSummaryError(false);
      } else {
        const [s, salesUsage] = await Promise.all([
          getSummary(token, selectedShop!.id, PERIOD_TO_API[period]),
          getSalesUsage(token),
        ]);
        if (isStale()) return;
        setSummary(s);
        setSummaryPeriod(period);
        setPerShopProfit([]);
        setUsage(salesUsage);
        setSummaryError(false);
      }
    } catch {
      if (isStale()) return;
      setSummary(null);
      setSummaryPeriod(null);
      setPerShopProfit([]);
      setUsage(null);
      setSummaryError(true);
    } finally {
      if (!isStale()) setSummaryLoading(false);
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
  //
  // O loop de polling vive vários segundos - antes ele fechava sobre o
  // selectedShop/loadSummary da loja A, e terminar DEPOIS de trocar pra
  // loja B recarregava o resumo de A por cima da tela de B (o id novo de
  // request passava pela guarda de resposta velha do loadSummary). Agora o
  // loop é amarrado a um shopId fixo, para sozinho se a loja selecionada
  // mudar (ou a tela desmontar), e sempre chama a versão MAIS RECENTE das
  // funções de recarga via ref.
  const selectedShopIdRef = useRef<string | null>(selectedShop?.id ?? null);
  const tokenRef = useRef(token);
  const reloadAfterSyncRef = useRef(() => Promise.all([refreshShops(), loadSummary(), loadForecast()]));
  useEffect(() => {
    selectedShopIdRef.current = selectedShop?.id ?? null;
    tokenRef.current = token;
    reloadAfterSyncRef.current = () => Promise.all([refreshShops(), loadSummary(), loadForecast()]);
  });
  // Qual loja tem um loop de polling rodando agora - evita dois loops em
  // paralelo pra mesma loja (ex: efeito de troca de loja + botão Sincronizar).
  const pollingShopIdRef = useRef<string | null>(null);
  // Cada loop ganha um número; trocar de loja incrementa e invalida o loop
  // anterior de vez - só comparar shopId deixava o loop velho "reviver" se a
  // pessoa voltasse pra mesma loja antes dele acordar do setTimeout.
  const pollGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pollingShopIdRef.current = null;
    };
  }, []);

  const pollSyncUntilDone = useCallback(async (shopId: string) => {
    if (pollingShopIdRef.current === shopId) return;
    pollingShopIdRef.current = shopId;
    const generation = ++pollGenerationRef.current;
    const stillCurrent = () =>
      mountedRef.current && pollGenerationRef.current === generation && selectedShopIdRef.current === shopId;
    const MAX_CONSECUTIVE_FAILURES = 15;
    let consecutiveFailures = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, 3000));
        const currentToken = tokenRef.current;
        if (!stillCurrent() || !currentToken) break;
        let status;
        try {
          status = await getSyncStatus(currentToken, shopId);
        } catch (err) {
          if (!stillCurrent()) break;
          consecutiveFailures++;
          if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
            showAlert('Não foi possível sincronizar', err instanceof ApiError ? err.message : 'Verifique sua internet e tente de novo.');
            break;
          }
          continue;
        }
        if (!stillCurrent()) break;
        consecutiveFailures = 0;
        if (status.status === 'done') {
          await reloadAfterSyncRef.current();
          break;
        }
        if (status.status === 'error') {
          showAlert('Não foi possível sincronizar', status.error ?? 'Tenta de novo em instantes.');
          break;
        }
      }
    } finally {
      if (pollGenerationRef.current === generation) pollingShopIdRef.current = null;
      // Só apaga o "Sincronizando..." dessa loja se nenhum loop NOVO já
      // estiver acompanhando ela (ex: a pessoa voltou pra essa loja).
      if (mountedRef.current && pollingShopIdRef.current !== shopId) {
        setSyncingShopId((prev) => (prev === shopId ? null : prev));
      }
    }
  }, []);

  useEffect(() => {
    // Trocou de loja: qualquer loop da loja anterior para sozinho (ver
    // stillCurrent acima); o botão já segue a loja nova sozinho (ver
    // syncingShopId).
    pollingShopIdRef.current = null;
    pollGenerationRef.current++;
    if (!token || !selectedShop) return;
    const shopId = selectedShop.id;
    getSyncStatus(token, shopId)
      .then((status) => {
        if (selectedShopIdRef.current !== shopId || !mountedRef.current) return;
        if (status.status === 'running') {
          setSyncingShopId(shopId);
          pollSyncUntilDone(shopId);
        } else if (pollingShopIdRef.current !== shopId) {
          setSyncingShopId((prev) => (prev === shopId ? null : prev));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShop?.id]);

  async function handleSync() {
    if (!token || !selectedShop) return;
    const shopId = selectedShop.id;
    setSyncingShopId(shopId);
    try {
      await startSync(token, shopId);
    } catch (err) {
      setSyncingShopId((prev) => (prev === shopId ? null : prev));
      showAlert('Não foi possível sincronizar', err instanceof ApiError ? err.message : 'Tenta de novo em instantes.');
      return;
    }
    if (selectedShopIdRef.current !== shopId) {
      // Trocou de loja enquanto o startSync voltava - não acompanha (a loja
      // nova confere o próprio status ao ser selecionada).
      setSyncingShopId((prev) => (prev === shopId ? null : prev));
      return;
    }
    pollSyncUntilDone(shopId);
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
  const stillLoading = !shopsLoaded || (hasShop && summaryLoading && (summary === null || summaryPeriod !== period));
  // Mesmo tratamento de "ocultar lucro" do atraso de pagamento vale pra quem
  // passou do limite de vendas do plano - mesma UsageBar embaixo explica o
  // porquê.
  const isOverLimit = (usage?.overLimit ?? false) || subscriptionAccess.isPastDue;

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
  // Achado ao vivo: passado de 300/300 ainda mostrava "está perto do
  // limite" - mesmo aviso amarelo de quando falta pouco. Acima do limite é
  // mais grave (carência rodando, ver sales-usage.ts), merece cor e texto
  // diferentes.
  const overSalesLimit = salesUsed !== null && salesLimit !== null && salesUsed >= salesLimit;

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
  const marketplaceLabelText = viewingAll ? 'Marketplace' : marketplaceLabel(selectedShop?.provider ?? 'shopee');
  const marketplaceLabelLower = viewingAll ? 'do marketplace' : MARKETPLACE_LABELS_LOWER[selectedShop?.provider ?? 'shopee'];

  const kpiTiles = showingRealData
    ? [
        {
          label: 'Faturamento',
          value: formatBRL(summary!.revenue),
          helpText: 'Soma do valor de venda de todos os pedidos do período, sem descontar nada.',
          // Pedido recém-comprado (ainda não pago/concluído de verdade) não
          // entra no faturamento confirmado acima - sem isso, um dia com
          // venda de verdade mas sincronização/confirmação atrasada parecia
          // "não vendeu nada", o que já assustou cliente novo esperando o
          // primeiro sync terminar. Mostra como previsão à parte, nunca
          // somado ao valor confirmado.
          forecastLabel:
            forecast && forecast.pendingCount > 0 ? `+${formatBRL(forecast.projectedRevenue)} previsto` : undefined,
        },
        {
          label: 'Custos totais',
          value: formatBRL(summary!.cost),
          positiveIsGood: false,
          helpText: `Soma de tudo que sai do seu bolso no período: custo do produto, frete líquido e taxas ${marketplaceLabelLower}.`,
        },
        {
          label: `Líquido ${marketplaceLabelText}`,
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
    <Screen headerGradient>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerClassName="pb-8"
        contentContainerStyle={webCapWidth()}
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

        <AnnouncementsBanner />

        {showSalesLimitWarning && (
          <Pressable
            onPress={() => router.push('/planos')}
            className="mt-4 flex-row items-center gap-3 rounded-2xl border bg-lucrei-surface p-4"
            style={{ borderColor: overSalesLimit ? Colors.danger : Colors.gold }}>
            <Ionicons name="warning-outline" size={20} color={overSalesLimit ? Colors.danger : Colors.gold} />
            <View className="flex-1">
              <Text className="text-sm font-semibold text-lucrei-text">
                {salesUsed} de {salesLimit} vendas usadas esse mês
              </Text>
              <Text className="mt-0.5 text-xs text-lucrei-textMuted">
                {overSalesLimit
                  ? 'Você excedeu o limite do seu plano. Toque para ver planos maiores.'
                  : 'Você está perto do limite do seu plano. Toque para ver planos maiores.'}
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
            {summaryLoading && <ActivityIndicator size="small" color={Colors.gold} />}
          </View>

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
            <GlassCard className="mt-4">
              <View className={isDesktop ? 'flex-row items-center justify-between p-8' : 'p-6'}>
                <View className={isDesktop ? 'flex-1' : undefined}>
                  {/* Lucro travado em R$0,00 (todo item sem custo cadastrado)
                      parecia número quebrado/erro - mostra o líquido (sem o
                      custo do produto, que vem pronto da Shopee/ML, mesma
                      conta do anel) em vez de um zero seco, deixando claro
                      que ainda falta cadastrar custo pra ver o lucro real.
                      Só troca quando o lucro de verdade é mesmo zero - loja
                      com custo já cadastrado continua vendo o lucro normal. */}
                  {(() => {
                    const netBeforeProductCost = summary
                      ? summary.revenue - summary.shippingCost - summary.shopeeFees - summary.taxCost
                      : 0;
                    const showNet =
                      !stillLoading && summary && summary.profit === 0 && summary.itemsMissingCost > 0 && netBeforeProductCost !== 0;
                    // "Você lucrou R$ -50,00" em dourado lia como lucro -
                    // prejuízo ganha título e cor de perigo próprios.
                    const isLoss = !stillLoading && !showNet && !!summary && summary.profit < 0;
                    return (
                      <>
                        <View className="flex-row items-center gap-2">
                          <Text className="text-sm text-lucrei-textMuted">
                            {showNet ? 'Líquido (falta custo do produto)' : isLoss ? 'Prejuízo no período' : 'Você lucrou'}
                          </Text>
                          {!stillLoading && summaryLoading && <ActivityIndicator size="small" color={Colors.textMuted} />}
                        </View>
                        {stillLoading ? (
                          <View className="mt-3 h-[52px] justify-center">
                            <ActivityIndicator color={Colors.gold} />
                          </View>
                        ) : isOverLimit ? (
                          <View className="mt-3">
                            <BlurredValue width={180} height={isDesktop ? 52 : 44} />
                          </View>
                        ) : syncingNow && summary!.ordersCount === 0 ? (
                          <View className="mt-3 flex-row items-center gap-2">
                            <ActivityIndicator size="small" color={Colors.gold} />
                            <Text className="text-base font-medium text-lucrei-textMuted">Buscando seus pedidos recentes...</Text>
                          </View>
                        ) : (
                          <>
                            <Text
                              className={isDesktop ? 'mt-1 text-6xl font-bold' : 'mt-1 text-5xl font-bold'}
                              style={{ color: showNet ? Colors.text : isLoss ? Colors.danger : Colors.gold }}>
                              {formatBRL(showNet ? netBeforeProductCost : summary!.profit)}
                            </Text>
                            {/* Mesmo raciocínio do Faturamento: pedido ainda
                                não confirmado não some do lucro no card, só
                                não entra no valor principal (ainda é uma
                                estimativa, não lucro garantido). */}
                            {forecast && forecast.pendingCount > 0 && (
                              <Text className="mt-1 text-sm text-lucrei-textMuted">
                                +{formatBRL(forecast.projectedProfit)} previsto em {forecast.pendingCount}{' '}
                                {forecast.pendingCount === 1 ? 'pedido' : 'pedidos'} ainda confirmando
                              </Text>
                            )}
                          </>
                        )}
                      </>
                    );
                  })()}
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
                      {isOverLimit ? (
                        <BlurredValue width={296} height={56} />
                      ) : (
                        <Sparkline data={summary!.trend} />
                      )}
                    </View>
                  )}

                </View>

                {!stillLoading && isDesktop && (
                  <View className="flex-row items-center gap-6">
                    {isOverLimit ? (
                      <>
                        <BlurredValue width={84} height={84} />
                        <BlurredValue width={84} height={84} />
                        <BlurredValue width={260} height={110} />
                      </>
                    ) : (
                      <>
                        {summary && (
                          <>
                            <RevenueRing revenue={summary.revenue} size={84} strokeWidth={13} />
                            <ProfitBreakdownDonut summary={summary} size={84} strokeWidth={13} />
                          </>
                        )}
                        <Sparkline data={summary!.trend} width={260} height={110} />
                      </>
                    )}
                  </View>
                )}
              </View>
            </GlassCard>

            <PastDueBanner />

            {usage && <UsageBar usage={usage} />}

            {/* Conectar a loja só traz pedido novo daqui pra frente - sem
                isso, muita gente achava que o Lucrei "não estava puxando os
                pedidos antigos" e não sabia que existia um botão pra isso
                (reportado ao vivo, o botão só existia escondido lá em
                Relatórios). Só pra loja selecionada de verdade (não "Todas
                as lojas") e só marketplace que tem backfill de verdade no
                backend (Shopee, Mercado Livre, TikTok Shop - iFood não tem
                histórico pra puxar) - some sozinho depois que o histórico já
                foi puxado uma vez. */}
            {token &&
              !viewingAll &&
              selectedShop &&
              supportsHistoryBackfill(selectedShop.provider) &&
              selectedShop.historyBackfillStatus !== 'done' && (
              <View className="mt-4">
                <HistoryBackfillCard
                  token={token}
                  shopId={selectedShop.id}
                  provider={selectedShop.provider}
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
                    <StatTile key={kpi.label} {...kpi} blurred={isOverLimit} large />
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
                    <StatTile key={kpi.label} {...kpi} blurred={isOverLimit} />
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
                {isOverLimit ? (
                  <BlurredValue width={70} />
                ) : (
                  <Text className="text-lg font-bold" style={{ color: Colors.goldDim }}>
                    {formatBRL(forecast.projectedProfit)}
                  </Text>
                )}
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} style={{ marginLeft: 6 }} />
              </Pressable>
            )}

            {/* Pedido já pago/confirmado (não é estimativa, já está no
                "Você lucrou" acima) mas ainda não despachado - pedido ao
                vivo ("tem como colocar os pedidos aguardando envio em algum
                lugar?"). Só Shopee expõe esse status granular hoje. */}
            {!stillLoading && forecast !== null && forecast.readyToShipCount > 0 && (
              <Pressable
                onPress={() => router.push('/pedidos')}
                hitSlop={4}
                style={({ pressed }) => [
                  { borderColor: Colors.goldDim, backgroundColor: Colors.surfaceAlt, opacity: pressed ? 0.7 : 1 },
                ]}
                className="mt-3 flex-row items-center justify-between rounded-2xl border border-dashed p-4">
                <View className="flex-row items-center gap-3">
                  <Ionicons name="cube-outline" size={20} color={Colors.gold} />
                  <Text className="text-sm font-medium text-lucrei-text">
                    {forecast.readyToShipCount} {forecast.readyToShipCount === 1 ? 'pedido aguardando' : 'pedidos aguardando'} envio
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
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
                  <GlassCard key={shop.shopId} className="flex-row items-center justify-between p-3.5" borderRadius={16}>
                    <View className="flex-row items-center gap-3">
                      <MarketplaceBadge provider={shop.provider} />
                      <Text className="text-sm text-lucrei-text" numberOfLines={1}>
                        {shop.shopName}
                      </Text>
                    </View>
                    {isOverLimit ? (
                      <BlurredValue width={70} />
                    ) : (
                      <Text
                        className="text-sm font-bold"
                        style={{ color: shop.profit >= 0 ? Colors.gold : Colors.danger }}>
                        {formatBRL(shop.profit)}
                      </Text>
                    )}
                  </GlassCard>
                ))}
              </View>
            )}
          </>
        ) : hasShop && summaryError ? (
          <GlassCard className="mt-6 items-center gap-3 px-6 py-10">
            <Ionicons name="cloud-offline-outline" size={32} color={Colors.textMuted} />
            <Text className="text-center text-sm text-lucrei-textMuted">Não foi possível carregar seu resumo.</Text>
            <Pressable onPress={() => loadSummary()} className="rounded-xl bg-lucrei-surface px-4 py-2">
              <Text className="text-sm text-lucrei-gold">Tentar de novo</Text>
            </Pressable>
          </GlassCard>
        ) : (
          // Sem loja conectada ainda - antes mostrava um período/lucro/KPIs
          // de exemplo com números inventados (ex: "R$ 40.250,00"), o que
          // dava a entender que era algo real. Um estado vazio simples é
          // mais honesto e já deixa claro o que fazer a seguir.
          <GlassCard className="mt-6 items-center px-6 py-12">
            <Ionicons name="storefront-outline" size={32} color={Colors.textMuted} />
            <Text className="mt-3 text-center text-base font-semibold text-lucrei-text">
              Conecte sua loja Shopee, Mercado Livre, iFood ou TikTok Shop pra ver seu lucro real aqui
            </Text>
            <Text className="mt-1 max-w-xs text-center text-sm text-lucrei-textMuted">
              Faturamento, custos e lucro de cada venda aparecem automaticamente assim que você conectar.
            </Text>
          </GlassCard>
        )}

        {/* No desktop largo, Conquistas já mora fixa na barra lateral (ver
            DesktopShell) - manter aqui também seria duplicado. */}
        {!isDesktop && state.status === 'authenticated' && hasShop && lifetimeProfit !== null && (
          <AchievementsCard totalProfit={lifetimeProfit} accountCreatedAt={state.user.createdAt} />
        )}

        {/* Um botão só que abre a lista de marketplaces - o que não tiver
            credencial no servidor aparece cinza "Em breve" (ver
            ConnectMarketplaceMenu). */}
        {state.status === 'authenticated' && (
          <View className="mt-8">
            <ConnectMarketplaceMenu
              token={state.token}
              connecting={connecting}
              width={isDesktop ? 440 : '100%'}
              onSelect={(marketplace) => {
                if (marketplace === 'shopee') handleConnectShopee();
                else if (marketplace === 'mercado_livre') handleConnectMercadoLivre();
                else if (marketplace === 'ifood') handleConnectIfood();
                else handleConnectTiktokShop();
              }}
            />
          </View>
        )}
        <Text className="mt-2 text-center text-xs text-lucrei-textMuted">
          {hasShop ? 'Conectar outra loja' : 'Conecte sua loja'}
        </Text>
        {state.status === 'authenticated' && ifoodModalVisible && (
          <IfoodConnectModal
            token={state.token}
            onClose={() => setIfoodModalVisible(false)}
            onConnected={handleIfoodConnected}
          />
        )}
        {!stillLoading && (hasShop || showingRealData) && (
          <Text className="mt-3 text-center text-xs text-lucrei-textMuted">
            {(() => {
              // selectedShop só é lido DENTRO de showingRealData/hasShop -
              // os dois só são true quando existe loja ativa de verdade
              // (ver comentário acima de hasShop). Calcular shopLabel antes
              // dessa checagem quebrava com "Cannot read properties of
              // null" pra quem não tem nenhuma loja ativa (só uma
              // desconectada, por exemplo) - selectedShop!.shopName rodava
              // mesmo indo cair no fallback "conecte sua loja" logo depois.
              if (showingRealData || summaryError) {
                const shopLabel = viewingAll ? 'Todas as lojas' : selectedShop!.shopName;
                return `Loja conectada: ${shopLabel}.`;
              }
              if (hasShop) {
                const shopLabel = viewingAll ? 'Todas as lojas' : selectedShop!.shopName;
                return `Loja conectada: ${shopLabel}. Ainda sem pedidos sincronizados nesse período.`;
              }
              // Sem loja ativa: não tem mais números de exemplo na tela (ver
              // estado vazio acima), então não mostra rodapé nenhum.
              return null;
            })()}
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}
