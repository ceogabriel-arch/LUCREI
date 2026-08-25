/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        lucrei: {
          bg: '#0A0A0B',
          surface: '#161617',
          surfaceAlt: '#1F1F21',
          border: '#2A2A2D',
          gold: '#F5C518',
          goldDim: '#B4900F',
          text: '#FFFFFF',
          textMuted: '#9B9BA1',
          success: '#3DD68C',
          danger: '#F0554E',
        },
      },
    },
  },
  plugins: [],
};
