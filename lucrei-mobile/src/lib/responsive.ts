import { Platform } from 'react-native';

export const WEB_MAX_WIDTH = 480;

/**
 * Caps content to a phone-sized column and centers it — only on web.
 * Native rendering (iOS/Android) is completely untouched.
 */
export function webCapWidth() {
  if (Platform.OS !== 'web') return undefined;
  return { width: '100%' as const, maxWidth: WEB_MAX_WIDTH, alignSelf: 'center' as const };
}
