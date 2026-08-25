import { DarkTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';

import { Colors } from '@/constants/theme';
import AppTabs from '@/components/app-tabs';
import { LoginScreen } from '@/components/login-screen';
import { SignupScreen } from '@/components/signup-screen';
import { AuthProvider, useAuth } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();

const LucreiTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: Colors.gold,
    background: Colors.bg,
    card: Colors.surface,
    text: Colors.text,
    border: Colors.border,
  },
};

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

export default function RootLayout() {
  return (
    <ThemeProvider value={LucreiTheme}>
      <StatusBar style="light" />
      <AuthProvider>
        <RootNavigator />
      </AuthProvider>
    </ThemeProvider>
  );
}
