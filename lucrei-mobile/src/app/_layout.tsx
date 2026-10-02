import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { vars } from 'nativewind';
import * as Notifications from 'expo-notifications';
import * as Sentry from '@sentry/react-native';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import AppTabs from '@/components/app-tabs';
import { AlertHost } from '@/components/alert-host';
import { DesktopShell } from '@/components/desktop-shell';
import { LoginScreen } from '@/components/login-screen';
import { SignupScreen } from '@/components/signup-screen';
import { DarkColors, DarkCssVars, LightCssVars } from '@/constants/theme';
import { savePushToken } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { DataRefreshProvider, useDataRefresh } from '@/lib/data-refresh';
import { PeriodProvider } from '@/lib/period';
import { registerForPushNotifications } from '@/lib/push-notifications';
import { SelectedShopProvider } from '@/lib/selected-shop';
import { AppThemeProvider, ThemeContext, useAppTheme } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

// Sem DSN (ex: dev local sem .env configurado), o SDK fica desativado e não
// manda nada - só passa a reportar quando EXPO_PUBLIC_SENTRY_DSN existir.
Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.2,
});

type AuthScreen = 'login' | 'signup';

function RootNavigator() {
  const { state } = useAuth();
  const [screen, setScreen] = useState<AuthScreen>('login');
  const { triggerRefresh } = useDataRefresh();

  useEffect(() => {
    if (state.status !== 'loading') {
      SplashScreen.hideAsync();
    }
  }, [state.status]);

  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const token = state.token;
    registerForPushNotifications().then((pushToken) => {
      if (pushToken) savePushToken(token, pushToken).catch(() => {});
    });
  }, [state.status]);

  // Pedido concluído (ou qualquer outro push) chegando enquanto o app está
  // aberto - recarrega os dados sozinho em vez de deixar o usuário achando
  // que o app não pegou a notificação. Os dois listeners cobrem tanto o
  // banner aparecendo com o app em primeiro plano quanto o toque numa
  // notificação recebida com o app em segundo plano.
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const receivedSub = Notifications.addNotificationReceivedListener(() => triggerRefresh());
    const responseSub = Notifications.addNotificationResponseReceivedListener(() => triggerRefresh());
    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [state.status, triggerRefresh]);

  if (state.status === 'loading') {
    return null;
  }

  if (state.status === 'authenticated') {
    return (
      <DesktopShell>
        <AppTabs />
      </DesktopShell>
    );
  }

  // Login/cadastro são sempre no visual escuro da marca (painel + sparkline
  // dourada), de propósito - não seguem a preferência clara/escura da conta
  // (essa só existe depois de logado, em Configurações). Sem isso, quem
  // tinha escolhido "Claro" via a última sessão via o cartão do formulário
  // virar branco em cima do painel de marca, que fica escuro fixo - relatado
  // ao vivo como a tela de login "bugando". Duas camadas de override: os
  // vars CSS (classes bg-lucrei-*/text-lucrei-*) e o próprio ThemeContext
  // (cobre o que usa Colors.xxx direto, tipo a logo clara/escura e ícones).
  return (
    <View style={[{ flex: 1 }, vars(DarkCssVars)]}>
      <ThemeContext.Provider
        value={{ preference: 'dark', setPreference: () => {}, scheme: 'dark', colors: DarkColors }}>
        {screen === 'login' ? (
          <LoginScreen onNavigateToSignup={() => setScreen('signup')} />
        ) : (
          <SignupScreen onNavigateToLogin={() => setScreen('login')} />
        )}
      </ThemeContext.Provider>
    </View>
  );
}

function ThemedNavigation() {
  const { scheme, colors } = useAppTheme();

  useEffect(() => {
    // app.json fixa um "backgroundColor" escuro estático pra janela raiz do
    // Android - no modo claro isso aparecia como uma faixa preta em áreas
    // sem conteúdo (embaixo da tab bar, por exemplo). Aqui a gente sobrepõe
    // isso em tempo real com a cor certa do tema atual.
    SystemUI.setBackgroundColorAsync(colors.bg);
  }, [colors.bg]);

  const navigationTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.gold,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
    },
  };

  return (
    <View style={[{ flex: 1 }, vars(scheme === 'dark' ? DarkCssVars : LightCssVars)]}>
      <NavigationThemeProvider value={navigationTheme}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <AuthProvider>
          <SelectedShopProvider>
            <PeriodProvider>
              <DataRefreshProvider>
                <RootNavigator />
                <AlertHost />
              </DataRefreshProvider>
            </PeriodProvider>
          </SelectedShopProvider>
        </AuthProvider>
      </NavigationThemeProvider>
    </View>
  );
}

function RootLayout() {
  return (
    <KeyboardProvider>
      <AppThemeProvider>
        <ThemedNavigation />
      </AppThemeProvider>
    </KeyboardProvider>
  );
}

export default Sentry.wrap(RootLayout);
