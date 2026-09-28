import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useState } from 'react';

import { getShops, type Shop } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getSelectedShopId, setSelectedShopId as persistSelectedShopId } from '@/lib/shop-storage';

type SelectedShopContextValue = {
  shops: Shop[];
  selectedShop: Shop | null;
  loaded: boolean;
  selectShop: (shopId: string) => void;
  refresh: () => Promise<void>;
};

const SelectedShopContext = createContext<SelectedShopContextValue | null>(null);

export function SelectedShopProvider({ children }: PropsWithChildren) {
  const { state } = useAuth();
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShopId, setSelectedShopIdState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // refreshUser() troca o objeto "state" inteiro por um novo a cada chamada,
  // mesmo com os mesmos dados (ver auth.tsx) - depender de "state" aqui
  // fazia esse refresh (e tudo que depende dele, tipo o resumo da tela de
  // Início) rodar de novo sempre que QUALQUER coisa atualizasse o usuário,
  // não só quando o token/login realmente mudava.
  const token = state.status === 'authenticated' ? state.token : null;

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const { shops } = await getShops(token);
      setShops(shops);
      // Só considera loja ATIVA pra manter selecionada/escolher automático -
      // sem isso, uma loja desconectada (ex: reconexão que falhou) continuava
      // "selecionada" e a Início mostrava o nome dela como se estivesse
      // conectada de verdade (cabeçalho + "Loja conectada: X"), contradizendo
      // "Lojas conectadas" em Configurações, que mostra o status real.
      const active = shops.filter((s) => s.status === 'active');
      setSelectedShopIdState((prev) => (prev && active.some((s) => s.id === prev) ? prev : (active[0]?.id ?? null)));
    } catch {
      // mantém o que já tinha carregado
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    if (state.status !== 'authenticated') {
      setShops([]);
      setSelectedShopIdState(null);
      setLoaded(false);
      return;
    }
    (async () => {
      const persisted = await getSelectedShopId();
      setSelectedShopIdState(persisted);
      await refresh();
    })();
  }, [state.status]);

  function selectShop(shopId: string) {
    setSelectedShopIdState(shopId);
    persistSelectedShopId(shopId);
  }

  // Mesmo raciocínio do refresh() acima - selectedShop nunca aponta pra uma
  // loja desconectada, mesmo que o id persistido/o primeiro da lista seja um.
  const activeShops = shops.filter((s) => s.status === 'active');
  const selectedShop = activeShops.find((s) => s.id === selectedShopId) ?? activeShops[0] ?? null;

  return (
    <SelectedShopContext.Provider value={{ shops, selectedShop, loaded, selectShop, refresh }}>
      {children}
    </SelectedShopContext.Provider>
  );
}

export function useSelectedShop() {
  const ctx = useContext(SelectedShopContext);
  if (!ctx) throw new Error('useSelectedShop precisa estar dentro de SelectedShopProvider');
  return ctx;
}
