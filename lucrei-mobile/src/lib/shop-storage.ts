import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const SELECTED_SHOP_KEY = 'lucrei_selected_shop_id';

export async function getSelectedShopId(): Promise<string | null> {
  if (Platform.OS === 'web') {
    return globalThis.localStorage?.getItem(SELECTED_SHOP_KEY) ?? null;
  }
  return SecureStore.getItemAsync(SELECTED_SHOP_KEY);
}

export async function setSelectedShopId(shopId: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(SELECTED_SHOP_KEY, shopId);
    return;
  }
  await SecureStore.setItemAsync(SELECTED_SHOP_KEY, shopId);
}
