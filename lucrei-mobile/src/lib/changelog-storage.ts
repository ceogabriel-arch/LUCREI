import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const LAST_SEEN_KEY = 'lucrei_changelog_last_seen';

export async function getLastSeenChangelogVersion(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(LAST_SEEN_KEY) ?? null;
  return SecureStore.getItemAsync(LAST_SEEN_KEY);
}

export async function setLastSeenChangelogVersion(version: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(LAST_SEEN_KEY, version);
    return;
  }
  await SecureStore.setItemAsync(LAST_SEEN_KEY, version);
}
