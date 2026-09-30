import { colorScheme as nativewindColorScheme } from 'nativewind';
import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react';

import { DarkColors, LightColors, type ThemeColors } from '@/constants/theme';
import { getThemePreference, setThemePreference as persistThemePreference } from '@/lib/theme-storage';

export type ThemePreference = 'light' | 'dark';
export type EffectiveScheme = 'light' | 'dark';

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  scheme: EffectiveScheme;
  colors: ThemeColors;
};

// Exportado só pra permitir um override local forçado (ver LoginScreen/
// SignupScreen em _layout.tsx - essas telas são sempre no visual escuro da
// marca, não seguem a preferência clara/escura da conta, que só existe
// depois de logado).
export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<ThemePreference>('dark');

  useEffect(() => {
    getThemePreference().then((persisted) => {
      if (persisted) setPreferenceState(persisted);
    });
  }, []);

  const scheme: EffectiveScheme = preference;

  useEffect(() => {
    nativewindColorScheme.set(scheme);
  }, [scheme]);

  function setPreference(next: ThemePreference) {
    setPreferenceState(next);
    persistThemePreference(next);
  }

  const colors = scheme === 'light' ? LightColors : DarkColors;

  return <ThemeContext.Provider value={{ preference, setPreference, scheme, colors }}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useAppTheme precisa estar dentro de AppThemeProvider');
  return ctx;
}

export function useColors() {
  return useAppTheme().colors;
}
