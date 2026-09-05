import '@/global.css';

// Tinta usada em texto/ícone sobre uma superfície dourada (botões, badges).
// Fica escura nos dois temas de propósito - dourado claro ou escuro sempre
// precisa de tinta escura em cima pra manter contraste.
const onGold = '#0A0A0B';

export const DarkColors = {
  bg: '#0A0A0B',
  surface: '#161617',
  surfaceAlt: '#1F1F21',
  border: '#2A2A2D',
  gold: '#F5C518',
  goldDim: '#B4900F',
  onGold,
  text: '#FFFFFF',
  textMuted: '#9B9BA1',
  success: '#3DD68C',
  danger: '#F0554E',
} as const;

export const LightColors = {
  bg: '#F7F7F5',
  surface: '#FFFFFF',
  surfaceAlt: '#F0F0EE',
  border: '#E2E2DF',
  // Um pouco mais escuro que o dourado do modo escuro pra manter contraste
  // num fundo claro, mas sem cair pro lado amarronzado/mostarda.
  gold: '#D4AF37',
  goldDim: '#9B8028',
  onGold,
  text: '#0A0A0B',
  textMuted: '#6B6B70',
  success: '#1E9F63',
  danger: '#D93B33',
} as const;

export type ThemeColors = { [K in keyof typeof DarkColors]: string };

function hexToRgbTriplet(hex: string) {
  const value = parseInt(hex.replace('#', ''), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `${r} ${g} ${b}`;
}

// Variáveis CSS por tema, no mesmo formato usado em global.css (--color-bg
// etc.). Usadas via a API vars() do NativeWind pra aplicar via style, sem
// depender da troca de classe ".dark" — que tem bug documentado no v4 em
// apps nativos (a troca não é aplicada de forma confiável).
function toCssVars(colors: ThemeColors) {
  return {
    '--color-bg': hexToRgbTriplet(colors.bg),
    '--color-surface': hexToRgbTriplet(colors.surface),
    '--color-surface-alt': hexToRgbTriplet(colors.surfaceAlt),
    '--color-border': hexToRgbTriplet(colors.border),
    '--color-gold': hexToRgbTriplet(colors.gold),
    '--color-gold-dim': hexToRgbTriplet(colors.goldDim),
    '--color-text': hexToRgbTriplet(colors.text),
    '--color-text-muted': hexToRgbTriplet(colors.textMuted),
    '--color-success': hexToRgbTriplet(colors.success),
    '--color-danger': hexToRgbTriplet(colors.danger),
  };
}

export const DarkCssVars = toCssVars(DarkColors);
export const LightCssVars = toCssVars(LightColors);
