import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';

import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/login-screen';
import { SignupScreen } from '@/components/signup-screen';
import { AuthProvider, useAuth } from '@/lib/auth';
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
    <NavigationThemeProvider value={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <AuthProvider>
        <SelectedShopProvider>
          <RootNavigator />
        </SelectedShopProvider>
      </AuthProvider>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <ThemedNavigation />
    </AppThemeProvider>
  );
}
