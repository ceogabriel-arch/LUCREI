import { createContext, useCallback, useContext, useState, type PropsWithChildren } from 'react';

type DataRefreshContextValue = {
  // Incrementa a cada vez que algo externo ao app (push de pedido concluído,
  // por exemplo) pode ter mudado os dados - telas escutam esse número pra
  // recarregar sozinhas, sem o usuário precisar puxar pra atualizar.
  refreshSignal: number;
  triggerRefresh: () => void;
};

const DataRefreshContext = createContext<DataRefreshContextValue | null>(null);

export function DataRefreshProvider({ children }: PropsWithChildren) {
  const [refreshSignal, setRefreshSignal] = useState(0);
  const triggerRefresh = useCallback(() => setRefreshSignal((n) => n + 1), []);

  return <DataRefreshContext.Provider value={{ refreshSignal, triggerRefresh }}>{children}</DataRefreshContext.Provider>;
}

export function useDataRefresh() {
  const ctx = useContext(DataRefreshContext);
  if (!ctx) throw new Error('useDataRefresh precisa estar dentro de DataRefreshProvider');
  return ctx;
}
