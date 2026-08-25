import type { PropsWithChildren } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView className="flex-1 bg-lucrei-bg">
      <View className="flex-1 px-5 pt-2">{children}</View>
    </SafeAreaView>
  );
}
