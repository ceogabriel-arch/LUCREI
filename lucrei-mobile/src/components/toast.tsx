import { useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';

import { Colors } from '@/constants/theme';

export type Toast = { title: string; message: string; tone: 'success' | 'error' };

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  function show(next: Toast) {
    setToast(next);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(3000),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }

  return { toast, opacity, show };
}

export function ToastBanner({ toast, opacity }: { toast: Toast | null; opacity: Animated.Value }) {
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
