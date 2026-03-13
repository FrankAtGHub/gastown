/**
 * CSS Custom Property Generator
 *
 * Generates CSS variable declarations from theme tokens for :root (light) and .dark scopes.
 * Used by apps/web/src/input.css to inject theme tokens as CSS custom properties.
 */
import { lightTokens, darkTokens, type ThemeTokens } from './tokens';

/** Convert camelCase token name to CSS variable name: backgroundSecondary → --fo-background-secondary */
function tokenToCssVar(key: string): string {
  return '--fo-' + key.replace(/([A-Z])/g, '-$1').toLowerCase();
}

/** Generate CSS variable declarations from a token set */
function generateVars(tokens: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(tokens)) {
    vars[tokenToCssVar(key)] = value;
  }
  return vars;
}

/** All CSS variable names mapped from token keys */
export const cssVarNames: Record<keyof ThemeTokens, string> = (() => {
  const names = {} as Record<string, string>;
  for (const key of Object.keys(lightTokens)) {
    names[key] = tokenToCssVar(key);
  }
  return names as Record<keyof ThemeTokens, string>;
})();

/** Light theme CSS variables (for :root) */
export const lightCssVars = generateVars(lightTokens);

/** Dark theme CSS variables (for .dark) */
export const darkCssVars = generateVars(darkTokens);

/**
 * Generate a CSS string with :root and .dark variable declarations.
 * Can be injected directly into a stylesheet.
 */
export function generateCssVariableSheet(): string {
  const lightLines = Object.entries(lightCssVars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');
  const darkLines = Object.entries(darkCssVars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  return `:root {\n${lightLines}\n}\n\n.dark {\n${darkLines}\n}`;
}
