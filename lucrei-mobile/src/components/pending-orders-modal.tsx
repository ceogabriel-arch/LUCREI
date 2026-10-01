import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCombinedPendingOrders, getPendingOrders, type PendingOrder } from '@/lib/api';
import { formatElapsed } from '@/lib/format';
import { ORDER_STATUS_LABELS } from '@/lib/order-status-labels';
import { useModalPresentation } from '@/lib/responsive';
import { useColors } from '@/lib/theme';

// Detalhe por trás do card "Previsão de lucro" no Início - mostra cada
// pedido comprado na Shopee que ainda não completou, e há quanto tempo está
// parado nesse status, ordenado do mais antigo pro mais recente (o que o
// backend já devolve).
export function PendingOrdersModal({
  visible,
  onClose,
  token,
  shopId,
}: {
  visible: boolean;
  onClose: () => void;
  token: string | null;
  shopId: string | null; // null = "Todas as lojas"
}) {
  const Colors = useColors();
  const modal = useModalPresentation();
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !token) return;
    let cancelled = false;
    setLoading(true);
    const fetcher = shopId ? getPendingOrders(token, shopId) : getCombinedPendingOrders(token);
    fetcher
      .then((data) => {
        if (!cancelled) setOrders(data);
      })
      .catch(() => {
        if (!cancelled) setOrders([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, token, shopId]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className={`flex-1 ${modal.overlayClassName} ${modal.overlayBgClassName}`}>
        <SafeAreaView
          edges={['bottom']}
          style={{ maxHeight: Dimensions.get('window').height * 0.85, ...modal.panelWidthStyle }}
          className={`${modal.panelClassName} bg-lucrei-bg`}>
          <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
            <View>
              <Text className="text-base font-semibold text-lucrei-text">Pedidos em processamento</Text>
              <Text className="text-xs text-lucrei-textMuted">Comprados na Shopee, ainda não concluídos</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={Colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={{ flexShrink: 1 }} contentContainerClassName="gap-2 p-5">
            {loading && <ActivityIndicator color={Colors.gold} />}
            {!loading && orders.length === 0 && (
              <Text className="text-sm text-lucrei-textMuted">Nenhum pedido em processamento no momento.</Text>
            )}
            {!loading &&
              orders.map((order) => (
                <View key={order.orderSn} className="rounded-2xl border border-lucrei-border bg-lucrei-surface p-4">
                  <View className="flex-row items-center justify-between">
                    <Text className="text-sm font-medium text-lucrei-text" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {order.product ?? order.orderSn}
                    </Text>
                    <Text className="text-xs text-lucrei-textMuted">{formatElapsed(order.orderDate)}</Text>
                  </View>
                  {order.product && (
                    <Text className="mt-0.5 text-xs text-lucrei-textMuted">{order.orderSn}</Text>
                  )}
                  <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
                    <View className="rounded-full bg-lucrei-surfaceAlt px-2.5 py-1">
                      <Text className="text-xs text-lucrei-textMuted">
                        {ORDER_STATUS_LABELS[order.status] ?? order.status}
                      </Text>
                    </View>
                    {order.shopName && (
                      <View className="rounded-full bg-lucrei-surfaceAlt px-2.5 py-1">
                        <Text className="text-xs text-lucrei-textMuted" numberOfLines={1}>
                          {order.shopName}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
