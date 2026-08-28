import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/constants/theme';
import { webCapWidth } from '@/lib/responsive';

type IconName = keyof typeof Ionicons.glyphMap;

type TabRoute = { key: string; name: string };
type TabBarProps = {
  state: { index: number; routes: TabRoute[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigation: any;
};

const TAB_META: Record<string, { active: IconName; inactive: IconName; label: string }> = {
  index: { active: 'home', inactive: 'home-outline', label: 'Início' },
  pedidos: { active: 'receipt', inactive: 'receipt-outline', label: 'Pedidos' },
  produtos: { active: 'cube', inactive: 'cube-outline', label: 'Produtos' },
  relatorios: { active: 'bar-chart', inactive: 'bar-chart-outline', label: 'Relatórios' },
  configuracoes: { active: 'settings', inactive: 'settings-outline', label: 'Config.' },
};

function CustomTabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  const visibleRoutes = state.routes.filter((route) => TAB_META[route.name]);

  return (
    <View style={{ paddingBottom: insets.bottom || 12, paddingHorizontal: 14, paddingTop: 4, ...webCapWidth() }}>
      <View
        className="flex-row items-center rounded-[28px] border border-lucrei-border bg-lucrei-surface"
        style={{
          paddingVertical: 6,
          paddingHorizontal: 6,
          shadowColor: '#000',
          shadowOpacity: 0.35,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 8 },
          elevation: 10,
        }}>
        {visibleRoutes.map((route) => {
          const isFocused = state.routes[state.index]?.key === route.key;
          const meta = TAB_META[route.name];

          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!isFocused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              className="flex-1 items-center justify-center gap-1 rounded-[22px] py-2.5"
              style={{ backgroundColor: isFocused ? Colors.surfaceAlt : 'transparent' }}>
              <Ionicons name={isFocused ? meta.active : meta.inactive} size={20} color={isFocused ? Colors.gold : Colors.textMuted} />
              <Text style={{ fontSize: 10, fontWeight: isFocused ? '600' : '400', color: isFocused ? Colors.gold : Colors.textMuted }}>
                {meta.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function AppTabs() {
  return (
    <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen name="pedidos" options={{ title: 'Pedidos' }} />
      <Tabs.Screen name="produtos" options={{ title: 'Produtos' }} />
      <Tabs.Screen name="relatorios" options={{ title: 'Relatórios' }} />
      <Tabs.Screen name="configuracoes" options={{ title: 'Config.' }} />
      <Tabs.Screen name="shopee-connected" options={{ href: null }} />
    </Tabs>
  );
}
