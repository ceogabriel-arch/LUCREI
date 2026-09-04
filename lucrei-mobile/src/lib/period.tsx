import { createContext, type PropsWithChildren, useContext, useState } from 'react';

export const PERIODS = ['Hoje', '7 dias', '30 dias'] as const;
export type PeriodLabel = (typeof PERIODS)[number];
export const PERIOD_TO_API: Record<PeriodLabel, 'today' | '7d' | '30d'> = {
  Hoje: 'today',
  '7 dias': '7d',
  '30 dias': '30d',
};

type PeriodContextValue = {
  period: PeriodLabel;
  setPeriod: (period: PeriodLabel) => void;
};

const PeriodContext = createContext<PeriodContextValue | null>(null);

// Compartilhado entre Início, Produtos, Relatórios e Pedidos - trocar o
// período numa tela não deve resetar nas outras.
export function PeriodProvider({ children }: PropsWithChildren) {
  const [period, setPeriod] = useState<PeriodLabel>('30 dias');
  return <PeriodContext.Provider value={{ period, setPeriod }}>{children}</PeriodContext.Provider>;
}

export function usePeriod() {
  const ctx = useContext(PeriodContext);
  if (!ctx) throw new Error('usePeriod precisa estar dentro de PeriodProvider');
  return ctx;
}
