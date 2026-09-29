import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MarketplaceBadge } from '@/components/marketplace-badge';
import { useModalPresentation } from '@/lib/responsive';
import { useSelectedShop } from '@/lib/selected-shop';
import { useColors } from '@/lib/theme';

export function ShopPicker() {
  // "Todas as lojas" agora é do contexto compartilhado (persiste sozinho,
  // igual escolher uma loja específica já fazia) - qualquer tela que use
  // esse picker ganha o modo automaticamente.
  const { shops, selectedShop, viewingAll, selectShop, selectAllShops } = useSelectedShop();
  const Colors = useColors();
  const modal = useModalPresentation();
  const [open, setOpen] = useState(false);
  const activeShopsCount = shops.filter((s) => s.status === 'active').length;

  const displayName = viewingAll ? 'Todas as lojas' : (selectedShop?.shopName ?? 'Nenhuma loja conectada');

  return (
    <>
      <Pressable
        onPress={() => shops.length > 0 && setOpen(true)}
        disabled={shops.length <= 1}
        className="mt-2 flex-row items-center self-start gap-1.5 rounded-full border px-3 py-1.5"
        style={{ borderColor: Colors.border, backgroundColor: Colors.surface }}
        hitSlop={8}>
        {!viewingAll && selectedShop ? (
          <MarketplaceBadge provider={selectedShop.provider} size={14} />
        ) : (
          <Ionicons name="storefront-outline" size={13} color={Colors.textMuted} />
        )}
        <Text className="text-xs font-medium text-lucrei-text">{displayName}</Text>
        {shops.length > 1 && <Ionicons name="chevron-down" size={13} color={Colors.textMuted} />}
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View className={`flex-1 ${modal.overlayClassName} ${modal.overlayBgClassName}`}>
          <SafeAreaView edges={['bottom']} style={{ maxHeight: '70%', ...modal.panelWidthStyle }} className={`${modal.panelClassName} bg-lucrei-bg`}>
            <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
              <Text className="text-base font-semibold text-lucrei-text">Suas lojas</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={{ flexShrink: 1 }} contentContainerClassName="gap-2.5 p-5">
              {activeShopsCount > 1 && (
                <Pressable
                  onPress={() => {
                    selectAllShops();
                    setOpen(false);
                  }}
                  className="flex-row items-center justify-between rounded-2xl border p-4"
                  style={{ borderColor: viewingAll ? Colors.gold : Colors.border }}>
                  <Text className="text-sm text-lucrei-text">Todas as lojas</Text>
                  {viewingAll && <Ionicons name="checkmark-circle" size={18} color={Colors.gold} />}
                </Pressable>
              )}
              {shops.map((shop) => {
                const active = !viewingAll && shop.id === selectedShop?.id;
                return (
                  <Pressable
                    key={shop.id}
                    onPress={() => {
                      selectShop(shop.id);
                      setOpen(false);
                    }}
                    className="flex-row items-center justify-between rounded-2xl border p-4"
                    style={{ borderColor: active ? Colors.gold : Colors.border }}>
                    <View className="flex-1 flex-row items-center gap-2.5 pr-2">
                      <MarketplaceBadge provider={shop.provider} size={20} />
                      <View className="flex-1">
                        <Text className="text-sm text-lucrei-text">{shop.shopName}</Text>
                        {shop.status !== 'active' && (
                          <Text className="mt-0.5 text-xs text-lucrei-textMuted">Desconectada</Text>
                        )}
                      </View>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={18} color={Colors.gold} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}
