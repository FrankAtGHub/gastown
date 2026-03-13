import type { Config } from 'tailwindcss';
import { createPreset } from 'fumadocs-ui/tailwind-plugin';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fieldOpsColors } = require('../../packages/theme/tailwind-colors.cjs');

const config: Config = {
  darkMode: 'class',
  content: [
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './node_modules/fumadocs-ui/dist/**/*.js',
  ],
  presets: [createPreset()],
  theme: {
    extend: {
      colors: {
        brand: {
          400: '#fbbf24', // amber-400
          500: '#f59e0b', // amber-500
          600: '#d97706', // amber-600
          700: '#b45309', // amber-700
        },
        fo: fieldOpsColors,
      },
    },
  },
};

export default config;
