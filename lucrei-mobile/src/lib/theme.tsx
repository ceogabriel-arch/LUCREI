import { colorScheme as nativewindColorScheme } from 'nativewind';
import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { DarkColors, LightColors, type ThemeColors } from '@/constants/theme';
import { getThemePreference, setThemePreference as persistThemePreference } from '@/lib/theme-storage';

export type ThemePreference = 'system' | 'light' | 'dark';
export type EffectiveScheme = 'light' | 'dark';

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
  scheme: EffectiveScheme;
  colors: ThemeColors;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function AppThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useSystemColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  useEffect(() => {
    getThemePreference().then((persisted) => {
      if (persisted) setPreferenceState(persisted);
    });
  }, []);

  const scheme: EffectiveScheme = preference === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : preference;

  useEffect(() => {
    // Sempre manda um valor concreto (nunca 'system') pro nativewind - no
    // web, o próprio 'system' dele só remove a classe .dark uma vez e não
    // acompanha mudança de tema do SO depois; aqui quem resolve o 'system'
    // é o useSystemColorScheme acima, reativo nas duas plataformas.
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
