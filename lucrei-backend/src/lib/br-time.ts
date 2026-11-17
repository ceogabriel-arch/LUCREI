// O servidor (Railway) roda em UTC, mas "hoje", "este mês" e o dia de um
// pedido pro vendedor são sempre no horário de Brasília. Usar new Date()
// com getDate()/toISOString() direto fazia o "Hoje" virar às 21h BRT e
// pedido feito à noite cair no dia seguinte nos gráficos/exportações.
// Intl em vez de offset fixo -03:00 pra continuar certo se o horário de
// verão voltar a existir algum dia.
export const BR_TIME_ZONE = 'America/Sao_Paulo';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BR_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

type WallClock = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function brWallClock(date: Date): WallClock {
  const parts: Record<string, number> = {};
  for (const p of partsFormatter.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

// Quanto o horário de Brasília está atrás do UTC nesse instante, em ms
// (positivo: 3h = 10_800_000 hoje em dia).
function brOffsetMs(date: Date): number {
  const w = brWallClock(date);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return truncated - asUtc;
}

// Instante UTC correspondente à meia-noite (horário de Brasília) de uma data
// de calendário (month 1-12; aceita dia/mês "estourado", ex. mês 13).
export function brMidnight(year: number, month: number, day: number): Date {
  const guess = Date.UTC(year, month - 1, day);
  // Duas passadas: o offset do palpite pode diferir do offset real da
  // meia-noite perto de uma troca de horário de verão.
  let result = guess + brOffsetMs(new Date(guess));
  result = guess + brOffsetMs(new Date(result));
  return new Date(result);
}

// Data de calendário (no horário de Brasília) em que um instante cai.
export function brDateParts(date: Date): { year: number; month: number; day: number } {
  const { year, month, day } = brWallClock(date);
  return { year, month, day };
}

export function startOfBrDay(date: Date = new Date()): Date {
  const { year, month, day } = brDateParts(date);
  return brMidnight(year, month, day);
}

export function startOfBrMonth(date: Date = new Date()): Date {
  const { year, month } = brDateParts(date);
  return brMidnight(year, month, 1);
}

// Chave YYYY-MM-DD do dia (horário de Brasília) - usada pra agrupar pedidos
// por dia nos gráficos.
export function brDayKey(date: Date): string {
  const { year, month, day } = brDateParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// dd/mm/aaaa no horário de Brasília (CSV de exportação).
export function formatBrDate(date: Date): string {
  const { year, month, day } = brDateParts(date);
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

// Date "de parede": mesmos números do horário de Brasília, mas gravados
// como se fossem UTC. Pra bibliotecas como o ExcelJS, que serializam a data
// pelos componentes UTC - sem isso a célula de um pedido das 22h BRT
// mostrava o dia seguinte no Excel.
export function toBrWallClockDate(date: Date): Date {
  const w = brWallClock(date);
  return new Date(Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second, date.getUTCMilliseconds()));
}
