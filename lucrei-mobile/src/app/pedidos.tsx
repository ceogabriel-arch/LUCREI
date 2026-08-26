import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Dimensions, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { ApiError, getOrders, getShops, syncOrders, type Order, type OrderLineItem, type Period, type Shop } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatBRL } from '@/lib/format';

type LoadState = 'loading' | 'no-shop' | 'ready' | 'error';

const PERIODS = ['Hoje', '7 dias', '30 dias'] as const;
const PERIOD_TO_API: Record<(typeof PERIODS)[number], Period> = {
  Hoje: 'today',
  '7 dias': '7d',
  '30 dias': '30d',
};

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
  return (
    <Modal visible={order != null} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/60">
        <SafeAreaView
          edges={['bottom']}
          style={{ maxHeight: Dimensions.get('window').height * 0.85 }}
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

type Toast = { title: string; message: string; tone: 'success' | 'error' };

function ToastBanner({ toast, opacity }: { toast: Toast | null; opacity: Animated.Value }) {
  if (!toast) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{ opacity, position: 'absolute', top: 8, left: 0, right: 0, zIndex: 50 }}>
      <View
        className="mx-5 rounded-2xl border bg-lucrei-surface p-4"
        style={{ borderColor: toast.tone === 'success' ? Colors.gold : Colors.danger }}>
        <Text
          className="text-sm font-semibold"
          style={{ color: toast.tone === 'success' ? Colors.gold : Colors.danger }}>
          {toast.title}
        </Text>
        <Text className="mt-1 text-xs text-lucrei-textMuted">{toast.message}</Text>
      </View>
    </Animated.View>
  );
}

function OrderRow({ order, onPress }: { order: Order; onPress: () => void }) {
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
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [shop, setShop] = useState<Shop | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('30 dias');
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  function showToast(next: Toast) {
    setToast(next);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(toastOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }

  const filteredOrders = orders.filter((o) =>
    o.shopeeOrderSn.toLowerCase().includes(search.trim().toLowerCase())
  );

  const load = useCallback(async () => {
    if (state.status !== 'authenticated') return;
    setLoadState((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const { shops } = await getShops(state.token);
      if (shops.length === 0) {
        setLoadState('no-shop');
        return;
      }
      setShop(shops[0]);
      const { orders } = await getOrders(state.token, shops[0].id, PERIOD_TO_API[period]);
      setOrders(orders);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, [state, period]);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSync() {
    if (state.status !== 'authenticated' || !shop) return;
    setSyncing(true);
    try {
      const result = await syncOrders(state.token, shop.id);
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
          <ScrollView showsVerticalScrollIndicator={false} contentContainerClassName="mt-4 gap-3 pb-8">
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
