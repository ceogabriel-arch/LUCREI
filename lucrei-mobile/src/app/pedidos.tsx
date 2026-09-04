import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Screen } from '@/components/screen';
import { ToastBanner, useToast } from '@/components/toast';
import { ApiError, getOrders, syncOrders, type Order, type OrderLineItem } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';
import { PERIOD_TO_API, PERIODS, usePeriod } from '@/lib/period';
import { webCapWidth } from '@/lib/responsive';
import { useSelectedShop } from '@/lib/selected-shop';
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
  return (
    <Modal visible={order != null} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <SafeAreaView
          edges={['bottom']}
          style={{ maxHeight: Dimensions.get('window').height * 0.85, ...webCapWidth() }}
          className="rounded-t-3xl bg-lucrei-bg">
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

function OrderRow({ order, onPress }: { order: Order; onPress: () => void }) {
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
        <Text className="text-sm text-lucrei-textMuted">Venda: {formatBRL(order.revenue)}</Text>
      </View>

      <View className="mt-2 flex-row items-center justify-between">
        <Text className="text-base font-semibold" style={{ color: hasProfit ? Colors.success : Colors.textMuted }}>
          {hasProfit ? `Lucro: ${formatBRL(order.profit!)}` : 'Custo não informado'}
        </Text>
        <View className="flex-row items-center gap-1">
          {order.itemsMissingCost > 0 && hasProfit && (
            <Text className="text-xs text-lucrei-textMuted">{order.itemsMissingCost} item(ns) sem custo</Text>
          )}
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
        </View>
      </View>
    </Pressable>
  );
}

export default function PedidosScreen() {
  const { state } = useAuth();
  const Colors = useColors();
  const { selectedShop, loaded: shopsLoaded } = useSelectedShop();
  const { period, setPeriod } = usePeriod();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [orders, setOrders] = useState<Order[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const { toast, opacity: toastOpacity, show: showToast } = useToast();

  const filteredOrders = orders.filter((o) =>
    o.shopeeOrderSn.toLowerCase().includes(search.trim().toLowerCase())
  );

  const load = useCallback(async () => {
    if (state.status !== 'authenticated' || !shopsLoaded) return;
    if (!selectedShop) {
      setLoadState('no-shop');
      return;
    }
    setLoadState((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const { orders } = await getOrders(state.token, selectedShop.id, PERIOD_TO_API[period]);
      setOrders(orders);
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

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleSync() {
    if (state.status !== 'authenticated' || !selectedShop) return;
    setSyncing(true);
    try {
      const result = await syncOrders(state.token, selectedShop.id);
      const title = result.ordersSynced > 0 ? 'Novidades por aqui!' : 'Tudo em dia';
      const message =
        result.ordersSynced === 0
          ? 'Nenhum pedido novo encontrado nesse período.'
          : result.ordersSynced === 1
            ? '1 pedido foi sincronizado e já está com o lucro calculado.'
            : `${result.ordersSynced} pedidos foram sincronizados e já estão com o lucro calculado.`;
      showToast({ title, message, tone: 'success' });
      await load();
    } catch (err) {
      showToast({
        title: 'Não deu certo dessa vez',
        message: err instanceof ApiError ? err.message : 'Tenta de novo em instantes.',
        tone: 'error',
      });
    } finally {
      setSyncing(false);
    }
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
                <OrderRow key={order.id} order={order} onPress={() => setSelectedOrder(order)} />
              ))
            )}
          </ScrollView>
        </>
      )}

      <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
    </Screen>
  );
}
