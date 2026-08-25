import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { ApiError, getOrders, getShops, syncOrders, type Order, type Period, type Shop } from '@/lib/api';
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

function OrderRow({ order }: { order: Order }) {
  const hasProfit = order.profit !== null;

  return (
    <View className="rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
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
        {order.itemsMissingCost > 0 && hasProfit && (
          <Text className="text-xs text-lucrei-textMuted">{order.itemsMissingCost} item(ns) sem custo</Text>
        )}
      </View>
    </View>
  );
}

export default function PedidosScreen() {
  const { state } = useAuth();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [shop, setShop] = useState<Shop | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('30 dias');
  const [syncing, setSyncing] = useState(false);

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
      Alert.alert(
        'Sincronização concluída',
        `${result.ordersSeen} pedido(s) encontrado(s), ${result.ordersSynced} sincronizado(s).`
      );
      await load();
    } catch (err) {
      Alert.alert('Erro', err instanceof ApiError ? err.message : 'Não foi possível sincronizar.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Screen>
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
          ) : (
            orders.map((order) => <OrderRow key={order.id} order={order} />)
          )}
        </ScrollView>
      )}
    </Screen>
  );
}
