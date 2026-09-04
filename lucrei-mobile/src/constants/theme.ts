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
  // Dourado mais escuro que o do modo escuro - o mesmo tom vibrante do dark
  // mode não tem contraste suficiente em cima de um fundo claro.
  gold: '#A9790A',
  goldDim: '#8A6308',
  onGold,
  text: '#0A0A0B',
  textMuted: '#6B6B70',
  success: '#1E9F63',
  danger: '#D93B33',
} as const;

export type ThemeColors = { [K in keyof typeof DarkColors]: string };
