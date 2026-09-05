import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { vars } from 'nativewind';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/login-screen';
import { SignupScreen } from '@/components/signup-screen';
import { DarkCssVars, LightCssVars } from '@/constants/theme';
import { savePushToken } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import { PeriodProvider } from '@/lib/period';
import { registerForPushNotifications } from '@/lib/push-notifications';
import { SelectedShopProvider } from '@/lib/selected-shop';
import { AppThemeProvider, useAppTheme } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

type AuthScreen = 'login' | 'signup';

function RootNavigator() {
  const { state } = useAuth();
  const [screen, setScreen] = useState<AuthScreen>('login');

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

  if (state.status === 'loading') {
    return null;
  }

  if (state.status === 'authenticated') {
    return <AppTabs />;
  }

  return screen === 'login' ? (
    <LoginScreen onNavigateToSignup={() => setScreen('signup')} />
  ) : (
    <SignupScreen onNavigateToLogin={() => setScreen('login')} />
  );
}

function ThemedNavigation() {
  const { scheme, colors } = useAppTheme();

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
              <RootNavigator />
            </PeriodProvider>
          </SelectedShopProvider>
        </AuthProvider>
      </NavigationThemeProvider>
    </View>
  );
}

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <ThemedNavigation />
    </AppThemeProvider>
  );
}
