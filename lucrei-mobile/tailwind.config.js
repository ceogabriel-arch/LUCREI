/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        lucrei: {
          bg: 'rgb(var(--color-bg) / <alpha-value>)',
          surface: 'rgb(var(--color-surface) / <alpha-value>)',
          surfaceAlt: 'rgb(var(--color-surface-alt) / <alpha-value>)',
          border: 'rgb(var(--color-border) / <alpha-value>)',
          gold: 'rgb(var(--color-gold) / <alpha-value>)',
          goldDim: 'rgb(var(--color-gold-dim) / <alpha-value>)',
          // Tinta pra texto/ícone sobre uma superfície dourada - fixa, não varia por tema.
          onGold: '#0A0A0B',
          text: 'rgb(var(--color-text) / <alpha-value>)',
          textMuted: 'rgb(var(--color-text-muted) / <alpha-value>)',
          success: 'rgb(var(--color-success) / <alpha-value>)',
          danger: 'rgb(var(--color-danger) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
};
