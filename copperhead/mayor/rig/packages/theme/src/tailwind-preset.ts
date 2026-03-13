/**
 * Tailwind CSS Preset for Field Ops Theme
 *
 * Maps theme tokens to Tailwind color utilities via CSS custom properties.
 * Usage in tailwind.config.cjs:
 *   const { fieldOpsColors } = require('@field-ops/theme/dist/tailwind-preset');
 *   module.exports = { theme: { extend: { colors: fieldOpsColors } } };
 *
 * Then use: bg-fo-background, text-fo-primary, border-fo-border, etc.
 * Colors automatically switch between light/dark via CSS variables in input.css.
 */
import type { ThemeTokens } from './tokens';
import { cssVarNames } from './css-variables';

/** Tailwind color map: each token maps to its CSS variable with a fallback */
function buildColorMap(): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const [tokenKey, varName] of Object.entries(cssVarNames)) {
    // Tailwind class name: fo-background, fo-text-secondary, etc.
    const className = tokenKey.replace(/([A-Z])/g, '-$1').toLowerCase();
    colors[className] = `var(${varName})`;
  }
  return colors;
}

/**
 * Tailwind-compatible color config.
 * Use as: theme.extend.colors.fo = fieldOpsColors
 * Generates classes like: bg-fo-background, text-fo-text, border-fo-border
 */
export const fieldOpsColors = buildColorMap();

/**
 * Full Tailwind preset (can be spread into config).
 * Namespaced under 'fo' to avoid conflicts with default Tailwind colors.
 */
export const fieldOpsPreset = {
  theme: {
    extend: {
      colors: {
        fo: fieldOpsColors,
      },
    },
  },
};
