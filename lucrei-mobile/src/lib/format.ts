const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatBRL(value: number) {
  return currencyFormatter.format(value);
}

// "há 2 dias" / "há 5 h" / "há 12 min" - usado no detalhe da previsão de
// lucro, pra mostrar há quanto tempo um pedido está parado sem concluir.
export function formatElapsed(since: Date | string): string {
  const sinceDate = typeof since === 'string' ? new Date(since) : since;
  const ms = Date.now() - sinceDate.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'agora mesmo';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} ${days === 1 ? 'dia' : 'dias'}`;
}
