export type Period = 'today' | '7d' | '30d' | 'all';

export function rangeStart(period: Period) {
  const now = new Date();
  if (period === 'all') {
    return new Date(0);
  }
  if (period === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const days = period === '7d' ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
