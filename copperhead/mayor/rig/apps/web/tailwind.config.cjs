const { fieldOpsColors } = require('../../packages/theme/tailwind-colors.cjs');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  // Enable class-based dark mode (controlled by ThemeProvider adding 'dark' class to <html>)
  darkMode: 'class',
  // No safelist needed - all status badge classes are now static in StatusBadge.jsx
  theme: {
    extend: {
      colors: {
        fo: fieldOpsColors,
      },
    },
  },
  plugins: [],
}
