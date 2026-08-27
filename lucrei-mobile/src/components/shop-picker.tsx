import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { useSelectedShop } from '@/lib/selected-shop';

export function ShopPicker() {
  const { shops, selectedShop, selectShop } = useSelectedShop();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => shops.length > 0 && setOpen(true)}
        className="mt-1.5 flex-row items-center gap-1"
        hitSlop={8}>
        <Text className="text-xs text-lucrei-textMuted">{selectedShop?.shopName ?? 'Nenhuma loja conectada'}</Text>
        {shops.length > 1 && <Ionicons name="chevron-down" size={12} color={Colors.textMuted} />}
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View className="flex-1 justify-end bg-black/60">
          <SafeAreaView edges={['bottom']} style={{ maxHeight: '70%' }} className="rounded-t-3xl bg-lucrei-bg">
            <View className="flex-row items-center justify-between border-b border-lucrei-border px-5 py-4">
              <Text className="text-base font-semibold text-lucrei-text">Suas lojas</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView style={{ flexShrink: 1 }} contentContainerClassName="gap-2.5 p-5">
              {shops.map((shop) => {
                const active = shop.id === selectedShop?.id;
                return (
                  <Pressable
                    key={shop.id}
                    onPress={() => {
                      selectShop(shop.id);
                      setOpen(false);
                    }}
                    className="flex-row items-center justify-between rounded-2xl border p-4"
                    style={{ borderColor: active ? Colors.gold : Colors.border }}>
                    <Text className="text-sm text-lucrei-text">{shop.shopName}</Text>
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
