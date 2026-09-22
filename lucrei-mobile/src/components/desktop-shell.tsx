import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { usePathname, useRouter } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useIsDesktopWeb } from '@/lib/responsive';
import { useAppTheme } from '@/lib/theme';

const LOGO_LIGHT = require('../../assets/images/lucrei-logo-light.png');
const LOGO_DARK = require('../../assets/images/lucrei-logo.png');
const LOGO_ASPECT = 449 / 153;
const LOGO_WIDTH = 120;
const LOGO_HEIGHT = LOGO_WIDTH / LOGO_ASPECT;

type IconName = keyof typeof Ionicons.glyphMap;

const NAV_ITEMS: { href: '/' | '/pedidos' | '/produtos' | '/relatorios' | '/etiquetas' | '/configuracoes'; active: IconName; inactive: IconName; label: string }[] = [
  { href: '/', active: 'home', inactive: 'home-outline', label: 'Início' },
  { href: '/pedidos', active: 'receipt', inactive: 'receipt-outline', label: 'Pedidos' },
  { href: '/produtos', active: 'cube', inactive: 'cube-outline', label: 'Produtos' },
  { href: '/relatorios', active: 'bar-chart', inactive: 'bar-chart-outline', label: 'Relatórios' },
  { href: '/etiquetas', active: 'print', inactive: 'print-outline', label: 'Etiquetas' },
  { href: '/configuracoes', active: 'settings', inactive: 'settings-outline', label: 'Configurações' },
];

// Menu lateral fixo pra quando o app roda numa janela larga de desktop (o
// app Electron, ou o site num navegador maximizado) - substitui a barra de
// abas de baixo, que continua existindo e funcionando normalmente em
// qualquer janela estreita (celular nativo ou web estreito).
export function DesktopShell({ children }: PropsWithChildren) {
  const isDesktop = useIsDesktopWeb();

  if (!isDesktop) return <>{children}</>;

  return <DesktopShellInner>{children}</DesktopShellInner>;
}

function DesktopShellInner({ children }: PropsWithChildren) {
  const { scheme, colors: Colors } = useAppTheme();
  const { logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <View className="flex-1 flex-row bg-lucrei-bg">
      <View className="w-60 justify-between border-r border-lucrei-border px-4 py-6">
        <View>
          <View style={{ width: LOGO_WIDTH, height: LOGO_HEIGHT, marginLeft: 8, marginBottom: 28 }}>
            <Image
              source={scheme === 'dark' ? LOGO_DARK : LOGO_LIGHT}
              style={{ width: '100%', height: '100%' }}
              contentFit="contain"
            />
          </View>

          <View className="gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Pressable
                  key={item.href}
                  onPress={() => router.push(item.href)}
                  className="flex-row items-center gap-3 rounded-xl px-3 py-2.5"
                  style={{ backgroundColor: isActive ? Colors.surfaceAlt : 'transparent' }}>
                  <Ionicons name={isActive ? item.active : item.inactive} size={18} color={isActive ? Colors.gold : Colors.textMuted} />
                  <Text style={{ color: isActive ? Colors.gold : Colors.textMuted, fontWeight: isActive ? '600' : '400', fontSize: 14 }}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Pressable
          onPress={logout}
          className="flex-row items-center gap-3 rounded-xl border border-lucrei-border px-3 py-2.5">
          <Ionicons name="log-out-outline" size={18} color={Colors.danger} />
          <Text style={{ color: Colors.danger, fontWeight: '600', fontSize: 14 }}>Sair da conta</Text>
        </Pressable>
      </View>

      <View className="flex-1">{children}</View>
    </View>
  );
}
