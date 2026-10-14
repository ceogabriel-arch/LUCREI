import { createContext, type PropsWithChildren, useContext, useEffect, useState } from 'react';

type TabBarVisibilityContextValue = {
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
};

const TabBarVisibilityContext = createContext<TabBarVisibilityContextValue | null>(null);

export function TabBarVisibilityProvider({ children }: PropsWithChildren) {
  const [hidden, setHidden] = useState(false);
  return <TabBarVisibilityContext.Provider value={{ hidden, setHidden }}>{children}</TabBarVisibilityContext.Provider>;
}

export function useTabBarVisibility() {
  const ctx = useContext(TabBarVisibilityContext);
  if (!ctx) throw new Error('useTabBarVisibility precisa estar dentro de TabBarVisibilityProvider');
  return ctx;
}

// Os modais em tela cheia (SettingsModal em configuracoes.tsx, etc) não usam
// o <Modal> nativo do RN (ver fullscreenOverlayStyle em responsive.ts) -
// renderizam como overlay dentro da própria árvore da tela, então em
// Android a barra de baixo (que vem de fora dessa árvore, no Tab Navigator)
// pode ficar por cima do modal em vez de atrás dele - reportado ao vivo com
// print mostrando o modal "Alterar nome" cortado pela barra. Em vez de
// brigar com a ordem de empilhamento entre árvores diferentes, chamar isso
// UMA VEZ na tela dona (com a condição "algum modal meu está aberto", não
// um por modal) some com a barra inteira enquanto durar.
export function useHideTabBarWhile(visible: boolean) {
  const { setHidden } = useTabBarVisibility();
  useEffect(() => {
    setHidden(visible);
    return () => setHidden(false);
  }, [visible, setHidden]);
}
