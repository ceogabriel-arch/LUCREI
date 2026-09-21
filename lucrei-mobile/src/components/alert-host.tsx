import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { registerAlertHandler, type AlertButton, type AlertState } from '@/lib/alert';
import { useColors } from '@/lib/theme';

// Montado uma vez em _layout.tsx - showAlert() em qualquer lugar do app
// dispara esse modal via registerAlertHandler, em vez de cada tela precisar
// renderizar o próprio popup de confirmação/erro.
export function AlertHost() {
  const Colors = useColors();
  const [state, setState] = useState<AlertState | null>(null);

  useEffect(() => {
    registerAlertHandler(setState);
    return () => registerAlertHandler(null);
  }, []);

  function handlePress(button: AlertButton) {
    setState(null);
    button.onPress?.();
  }

  function handleDismiss() {
    if (!state) return;
    const fallback = state.buttons.find((b) => b.style === 'cancel') ?? state.buttons[state.buttons.length - 1];
    handlePress(fallback);
  }

  return (
    <Modal visible={state != null} transparent animationType="fade" onRequestClose={handleDismiss}>
      <Pressable
        className="flex-1 items-center justify-center bg-black/70 px-6"
        onPress={handleDismiss}>
        {state && (
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-lucrei-border p-5"
            style={{ backgroundColor: Colors.surface }}>
            <Text className="text-base font-semibold text-lucrei-text">{state.title}</Text>
            {state.message && (
              <Text className="mt-2 text-sm leading-5 text-lucrei-textMuted">{state.message}</Text>
            )}

            <View className="mt-5 flex-row justify-end gap-2">
              {state.buttons.map((button, i) => {
                const isDestructive = button.style === 'destructive';
                const isCancel = button.style === 'cancel';
                return (
                  <Pressable
                    key={`${button.text}-${i}`}
                    onPress={() => handlePress(button)}
                    className="rounded-xl px-4 py-2.5"
                    style={{
                      backgroundColor: isDestructive ? Colors.danger : isCancel ? 'transparent' : Colors.gold,
                    }}>
                    <Text
                      className="text-sm font-medium"
                      style={{ color: isDestructive ? '#FFFFFF' : isCancel ? Colors.textMuted : Colors.onGold }}>
                      {button.text}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Pressable>
        )}
      </Pressable>
    </Modal>
  );
}
