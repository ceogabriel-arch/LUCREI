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

  const refresh = useCallback(async () => {
    if (state.status !== 'authenticated') return;
    try {
      const { shops } = await getShops(state.token);
      setShops(shops);
      setSelectedShopIdState((prev) => (prev && shops.some((s) => s.id === prev) ? prev : (shops[0]?.id ?? null)));
    } catch {
      // mantém o que já tinha carregado
    } finally {
      setLoaded(true);
    }
  }, [state]);

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

  const selectedShop = shops.find((s) => s.id === selectedShopId) ?? shops[0] ?? null;

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
