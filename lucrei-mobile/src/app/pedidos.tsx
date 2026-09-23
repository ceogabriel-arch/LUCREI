import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BlurredValue } from '@/components/blurred-value';
import { PastDueBanner } from '@/components/past-due-banner';
import { Screen } from '@/components/screen';
import { ToastBanner, useToast } from '@/components/toast';
import {
  ApiError,
  getOrders,
  getSalesUsage,
  getSyncStatus,
  startSync,
  type Order,
  type OrderLineItem,
  type SalesUsage,
} from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDataRefresh } from '@/lib/data-refresh';
import { formatBRL } from '@/lib/format';
import { PERIOD_TO_API, PERIODS, usePeriod } from '@/lib/period';
import { useModalPresentation } from '@/lib/responsive';
import { useSelectedShop } from '@/lib/selected-shop';
import { useSubscriptionAccess } from '@/lib/subscription-access';
import { useColors } from '@/lib/theme';

type LoadState = 'loading' | 'no-shop' | 'ready' | 'error';

const STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Aguardando pagamento',
  READY_TO_SHIP: 'Pronto pra envio',
  PROCESSED: 'Em processamento',
  SHIPPED: 'Enviado',
  COMPLETED: 'Concluído',
  IN_CANCEL: 'Cancelando',
  CANCELLED: 'Cancelado',
  TO_RETURN: 'Em devolução',
};

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function BreakdownRow({ label, value, isTotal }: { label: string; value: string; isTotal?: boolean }) {
  const Colors = useColors();
  return (
    <View className="flex-row items-center justify-between py-1.5">
      <Text className={isTotal ? 'text-sm font-semibold text-lucrei-text' : 'text-sm text-lucrei-textMuted'}>
        {label}
      </Text>
      <Text
        className={isTotal ? 'text-base font-bold' : 'text-sm text-lucrei-text'}
        style={isTotal ? { color: Colors.gold } : undefined}>
        {value}
      </Text>
    </View>
  );
}

function ItemBreakdown({ item }: { item: OrderLineItem }) {
  return (
    <View className="rounded-2xl border border-lucrei-border bg-lucrei-surfaceAlt p-4">
      <Text className="text-sm font-medium text-lucrei-text">
        {item.productName} {item.quantity > 1 ? `× ${item.quantity}` : ''}
      </Text>
      <View className="mt-2 border-t border-lucrei-border pt-2">
        <BreakdownRow label="Venda" value={formatBRL(item.salePrice)} />
        <BreakdownRow label="− Frete alocado" value={formatBRL(item.shippingFeeAllocated)} />
        <BreakdownRow label="− Taxa Shopee" value={formatBRL(item.shopeeFeeAllocated)} />
        <BreakdownRow
          label="− Custo do produto"
          value={item.productCostSnapshot != null ? formatBRL(item.productCostSnapshot) : 'não informado'}
        />
        <View className="mt-1 border-t border-lucrei-border pt-2">
          <BreakdownRow
            label="Lucro do item"
            value={item.profit != null ? formatBRL(item.profit) : 'não calculado'}
            isTotal
          />
        </View>
      </View>
    </View>
  );
}

function OrderDetailModal({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const Colors = useColors();
  const modal = useModalPresentation();
  return (
    <Modal visible={order != null} animationType="slide" transparent onRequestClose={onClose}>
      <View className={`flex-1 ${modal.overlayClassName} ${modal.overlayBgClassName}`}>
        <SafeAreaView
          edges={['bottom']}
          style={{ maxHeight: Dimensions.get('window').height * 0.85, ...modal.panelWidthStyle }}
          className={`${modal.panelClassName} bg-lucrei-bg`}>
          <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
            <View>
              <Text className="text-base font-semibold text-lucrei-text">{order?.shopeeOrderSn}</Text>
              <Text className="text-xs text-lucrei-textMuted">Como calculamos o lucro desse pedido</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={{ flexShrink: 1 }} contentContainerClassName="gap-3 p-5">
            {order?.lineItems.map((item) => (
              <ItemBreakdown key={item.id} item={item} />
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// Sem limite (salesLimit null) não mostra nada - não faz sentido uma barra
// de progresso pra um teto que não existe.
function UsageBar({ usage }: { usage: SalesUsage }) {
  const Colors = useColors();
  if (usage.salesLimit == null) return null;

  const fraction = Math.min(1, usage.ordersThisMonth / usage.salesLimit);
  const nearLimit = !usage.overLimit && fraction >= 0.8;
  const barColor = usage.overLimit ? Colors.danger : nearLimit ? Colors.gold : Colors.success;

  return (
    <View className="mt-4 rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-xs font-medium text-lucrei-textMuted">Vendas do mês</Text>
        <Text className="text-xs font-semibold" style={{ color: barColor }}>
          {usage.ordersThisMonth} / {usage.salesLimit}
        </Text>
      </View>
      <View className="mt-2 h-2 overflow-hidden rounded-full bg-lucrei-surfaceAlt">
        <View style={{ width: `${fraction * 100}%`, backgroundColor: barColor }} className="h-full rounded-full" />
      </View>
      {usage.blocked && (
        <Text className="mt-2 text-xs" style={{ color: Colors.danger }}>
          Limite atingido — novos pedidos não sincronizam mais até você fazer upgrade.
        </Text>
      )}
      {usage.overLimit && !usage.blocked && (
        <Text className="mt-2 text-xs" style={{ color: Colors.danger }}>
          Limite atingido — valores ocultos. Você tem {usage.graceDaysLeft}{' '}
          {usage.graceDaysLeft === 1 ? 'dia' : 'dias'} pra fazer upgrade antes da sincronização travar.
        </Text>
      )}
      {nearLimit && (
        <Text className="mt-2 text-xs text-lucrei-textMuted">Quase no limite do seu plano.</Text>
      )}
    </View>
  );
}

// Placeholder no lugar do valor real quando a conta está sobre o limite (na
// carência) - cria a mesma sensação de "borrado" sem depender de blur/filtro
// de CSS, que não é suportado de forma consistente no nativo.
function OrderRow({ order, onPress, locked }: { order: Order; onPress: () => void; locked: boolean }) {
  const Colors = useColors();
  const hasProfit = order.profit !== null;

  return (
    <Pressable
      onPress={onPress}
      className="rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium text-lucrei-text">{order.shopeeOrderSn}</Text>
        <Text className="text-xs text-lucrei-textMuted">{dateFormatter.format(new Date(order.orderDate))}</Text>
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <View className="rounded-full bg-lucrei-surfaceAlt px-2.5 py-1">
          <Text className="text-xs text-lucrei-textMuted">
            {STATUS_LABELS[order.orderStatus] ?? order.orderStatus}
          </Text>
        </View>
        {locked ? <BlurredValue width={80} /> : (
          <Text className="text-sm text-lucrei-textMuted">Venda: {formatBRL(order.revenue)}</Text>
        )}
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        {locked ? (
          <View className="flex-row items-center gap-1.5">
            <Ionicons name="lock-closed" size={13} color={Colors.textMuted} />
            <BlurredValue width={100} />
          </View>
        ) : (
          <Text className="text-base font-semibold" style={{ color: hasProfit ? Colors.success : Colors.textMuted }}>
            {hasProfit ? `Lucro: ${formatBRL(order.profit!)}` : 'Custo não informado'}
          </Text>
        )}
        <View className="flex-row items-center gap-1">
          {!locked && order.itemsMissingCost > 0 && hasProfit && (
            <Text className="text-xs text-lucrei-textMuted">{order.itemsMissingCost} item(ns) sem custo</Text>
          )}
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
        </View>
      </View>
    </Pressable>
  );
}

export default function PedidosScreen() {
  const { state, refreshUser } = useAuth();
  // Token em vez do objeto "state" inteiro: refreshUser() troca "state" por
  // um objeto novo a cada chamada (mesmo com os mesmos dados). Como "load"
  // aqui embaixo roda direto num useEffect(() => load(), [load]), qualquer
  // refresh de usuário em outro lugar do app (ex: polling da tela de Pix)
  // recarregava os pedidos de novo sem necessidade.
  const token = state.status === 'authenticated' ? state.token : null;
  const Colors = useColors();
  const { selectedShop, loaded: shopsLoaded } = useSelectedShop();
  const { period, setPeriod } = usePeriod();
  const { refreshSignal } = useDataRefresh();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [orders, setOrders] = useState<Order[]>([]);
  const [usage, setUsage] = useState<SalesUsage | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const { toast, opacity: toastOpacity, show: showToast } = useToast();
  const subscriptionAccess = useSubscriptionAccess();
  const isOverLimit = (usage?.overLimit ?? false) || subscriptionAccess.isPastDue;
  // Trocar de período com a tela já pronta mantém loadState em 'ready' (de
  // propósito, pra não piscar a tela inteira de loading) - sem isso, nada
  // avisa que a lista está recalculando enquanto o pedido não volta.
  const [reloading, setReloading] = useState(false);

  const filteredOrders = orders.filter((o) =>
    o.shopeeOrderSn.toLowerCase().includes(search.trim().toLowerCase())
  );

  const load = useCallback(async () => {
    if (!token || !shopsLoaded) return;
    if (!selectedShop) {
      setLoadState('no-shop');
      return;
    }
    setLoadState((prev) => (prev === 'ready' ? prev : 'loading'));
    setReloading(true);
    try {
      const [{ orders }, salesUsage] = await Promise.all([
        getOrders(token, selectedShop.id, PERIOD_TO_API[period]),
        getSalesUsage(token),
      ]);
      setOrders(orders);
      setUsage(salesUsage);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    } finally {
      setReloading(false);
    }
  }, [token, shopsLoaded, selectedShop, period]);

  // Só useFocusEffect (dispara no mount e a cada vez que a tela ganha foco) -
  // um useEffect(load, [load]) junto disparava a MESMA busca duas vezes em
  // paralelo (getOrders + getSalesUsage repetidos) toda vez que a tela abria
  // ou o período mudava, dobrando a espera à toa.
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
  // atualizar. refreshSignal > 0 evita recarregar de novo no mount (o
  // useFocusEffect acima já cobre isso).
  useEffect(() => {
    if (refreshSignal > 0) load();
  }, [refreshSignal, load]);

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // Sync roda solto no servidor (não trava a requisição até terminar - ver
  // routes.ts), então o app acompanha por polling. Tolera falha passageira
  // de conexão (~1min de tentativas) em vez de desistir na primeira, já que
  // o trabalho continua rodando do outro lado independente do navegador.
  const pollSyncUntilDone = useCallback(async () => {
    setSyncing(true);
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
            showToast({
              title: 'Não deu certo dessa vez',
              message: err instanceof ApiError ? err.message : 'Verifique sua internet e tente de novo.',
              tone: 'error',
            });
            break;
          }
          continue;
        }
        consecutiveFailures = 0;
        if (status.status === 'done') {
          const title = status.ordersSynced > 0 ? 'Novidades por aqui!' : 'Tudo em dia';
          const message =
            status.ordersSynced === 0
              ? 'Nenhum pedido novo encontrado nesse período.'
              : status.ordersSynced === 1
                ? '1 pedido foi sincronizado e já está com o lucro calculado.'
                : `${status.ordersSynced} pedidos foram sincronizados e já estão com o lucro calculado.`;
          showToast({ title, message, tone: 'success' });
          await load();
          break;
        }
        if (status.status === 'error') {
          showToast({
            title: 'Não deu certo dessa vez',
            message: status.error ?? 'Tenta de novo em instantes.',
            tone: 'error',
          });
          break;
        }
      }
    } finally {
      setSyncing(false);
    }
  }, [token, selectedShop, load, showToast]);

  // Se a tela recarregar no meio de um sync que já estava rodando, volta a
  // acompanhar em vez de deixar o botão parado sem refletir o servidor.
  useEffect(() => {
    if (!token || !selectedShop) return;
    getSyncStatus(token, selectedShop.id)
      .then((status) => {
        if (status.status === 'running') pollSyncUntilDone();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedShop?.id]);

  async function handleSync() {
    if (!token || !selectedShop) return;
    // Trava o botão JÁ AQUI, antes do await - senão sobra uma janela (a
    // duração da própria chamada de rede) em que o clique ainda não voltou
    // e o botão continua parecendo destravado, dando pra clicar de novo,
    // trocar de aba e voltar etc.
    setSyncing(true);
    try {
      await startSync(token, selectedShop.id);
    } catch (err) {
      setSyncing(false);
      showToast({
        title: 'Não deu certo dessa vez',
        message: err instanceof ApiError ? err.message : 'Tenta de novo em instantes.',
        tone: 'error',
      });
      return;
    }
    pollSyncUntilDone();
  }

  return (
    <Screen>
      <ToastBanner toast={toast} opacity={toastOpacity} />

      <View className="flex-row items-center justify-between">
        <View>
          <Text className="text-2xl font-bold text-lucrei-text">Pedidos</Text>
          <Text className="mt-1 text-sm text-lucrei-textMuted">Lucro de cada pedido sincronizado.</Text>
        </View>
        {loadState === 'ready' && (
          <Pressable
            onPress={handleSync}
            disabled={syncing}
            className="h-10 w-10 items-center justify-center rounded-xl bg-lucrei-surface"
            style={{ opacity: syncing ? 0.5 : 1 }}>
            {syncing ? (
              <ActivityIndicator size="small" color={Colors.gold} />
            ) : (
              <Ionicons name="sync" size={18} color={Colors.gold} />
            )}
          </Pressable>
        )}
      </View>

      {usage && <UsageBar usage={usage} />}
      <PastDueBanner />

      <View className="mt-5 flex-row items-center gap-2">
        <View className="flex-row self-start rounded-full bg-lucrei-surface p-1">
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
        {loadState === 'ready' && reloading && <ActivityIndicator size="small" color={Colors.gold} />}
      </View>

      {loadState === 'ready' && (
        <Text className="mt-3 text-xs text-lucrei-textMuted">
          {orders.length} {orders.length === 1 ? 'pedido' : 'pedidos'} nesse período
        </Text>
      )}

      {loadState === 'loading' && (
        <View className="mt-10 items-center">
          <ActivityIndicator color={Colors.gold} />
        </View>
      )}

      {loadState === 'no-shop' && (
        <Text className="mt-8 text-sm text-lucrei-textMuted">
          Conecte uma loja Shopee na tela Início pra ver seus pedidos aqui.
        </Text>
      )}

      {loadState === 'error' && (
        <View className="mt-8 items-center gap-3">
          <Text className="text-sm text-lucrei-textMuted">Não foi possível carregar seus pedidos.</Text>
          <Pressable onPress={load} className="rounded-xl bg-lucrei-surface px-4 py-2">
            <Text className="text-sm text-lucrei-gold">Tentar de novo</Text>
          </Pressable>
        </View>
      )}

      {loadState === 'ready' && (
        <>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Buscar pelo ID do pedido..."
            placeholderTextColor={Colors.textMuted}
            className="mt-4 rounded-xl border border-lucrei-border bg-lucrei-surface px-4 py-3 text-sm text-lucrei-text"
          />
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerClassName="mt-4 gap-3 pb-8"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.gold} />
            }>
            {orders.length === 0 ? (
              <View className="mt-4 items-center gap-3">
                <Text className="text-sm text-lucrei-textMuted">
                  Nenhum pedido sincronizado nesse período.
                </Text>
                <Pressable onPress={handleSync} disabled={syncing} className="rounded-xl bg-lucrei-surface px-4 py-2">
                  <Text className="text-sm text-lucrei-gold">Sincronizar agora</Text>
                </Pressable>
              </View>
            ) : filteredOrders.length === 0 ? (
              <Text className="text-sm text-lucrei-textMuted">Nenhum pedido encontrado pra "{search}".</Text>
            ) : (
              filteredOrders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  locked={isOverLimit}
                  onPress={() => {
                    if (subscriptionAccess.isPastDue) {
                      showToast({
                        title: 'Valores ocultos',
                        message: 'Regularize seu pagamento pra ver o detalhe de lucro desse pedido.',
                        tone: 'error',
                      });
                      return;
                    }
                    if (isOverLimit) {
                      showToast({
                        title: 'Valores ocultos',
                        message: 'Faça upgrade do seu plano pra ver o detalhe de lucro desse pedido.',
                        tone: 'error',
                      });
                      return;
                    }
                    setSelectedOrder(order);
                  }}
                />
              ))
            )}
          </ScrollView>
        </>
      )}

      <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
    </Screen>
  );
}
