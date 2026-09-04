import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { ThemePreference } from '@/lib/theme';

const THEME_KEY = 'lucrei_theme_preference';

export async function getThemePreference(): Promise<ThemePreference | null> {
  const value = Platform.OS === 'web' ? (globalThis.localStorage?.getItem(THEME_KEY) ?? null) : await SecureStore.getItemAsync(THEME_KEY);
  return value === 'system' || value === 'light' || value === 'dark' ? value : null;
}

export async function setThemePreference(preference: ThemePreference): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(THEME_KEY, preference);
    return;
  }
  await SecureStore.setItemAsync(THEME_KEY, preference);
}
