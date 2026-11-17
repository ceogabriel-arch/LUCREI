import { startOfBrDay, startOfBrMonth } from './br-time';

export type Period = 'today' | '7d' | '30d' | '90d' | 'all';

// Mês/dia no horário de Brasília, não no do servidor (UTC no Railway) -
// senão "Hoje" e o contador de vendas/mês viravam às 21h BRT.
export function startOfCurrentMonth() {
  return startOfBrMonth(new Date());
}

export function rangeStart(period: Period) {
  const now = new Date();
  if (period === 'all') {
    return new Date(0);
  }
  if (period === 'today') {
    return startOfBrDay(now);
  }
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
