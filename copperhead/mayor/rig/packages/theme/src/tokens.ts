/**
 * Field Ops Theme Tokens
 *
 * Framework-agnostic color token definitions for the Field Ops suite.
 * Consumed by:
 *   - Mobile (React Native): apps/mobile/src/theme/colors.ts
 *   - Web (Tailwind): via tailwind-preset (Phase 2)
 *   - Docs (Tailwind): via tailwind-preset (Phase 3)
 */

export interface ThemeTokens {
  // Backgrounds
  background: string;
  backgroundSecondary: string;
  backgroundTertiary: string;
  card: string;
  cardHover: string;

  // Text
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  // Borders
  border: string;
  borderLight: string;

  // Status (semantic)
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  error: string;
  errorBg: string;
  info: string;
  infoBg: string;

  // Brand
  primary: string;
  primaryLight: string;
  primaryDark: string;

  // Input
  inputBg: string;
  inputBorder: string;
  inputText: string;
  placeholder: string;
}

export const lightTokens: ThemeTokens = {
  // Backgrounds
  background: '#f8fafc',           // slate-50
  backgroundSecondary: '#f1f5f9',  // slate-100
  backgroundTertiary: '#e2e8f0',   // slate-200
  card: '#ffffff',
  cardHover: '#f1f5f9',

  // Text
  text: '#0f172a',                 // slate-900
  textSecondary: '#475569',        // slate-600
  textMuted: '#94a3b8',            // slate-400
  textInverse: '#ffffff',

  // Borders
  border: '#e2e8f0',               // slate-200
  borderLight: '#f1f5f9',          // slate-100

  // Status
  success: '#16a34a',              // green-600
  successBg: '#dcfce7',            // green-100
  warning: '#d97706',              // amber-600
  warningBg: '#fef3c7',            // amber-100
  error: '#dc2626',                // red-600
  errorBg: '#fee2e2',              // red-100
  info: '#2563eb',                 // blue-600
  infoBg: '#dbeafe',               // blue-100

  // Brand
  primary: '#1e40af',              // blue-800
  primaryLight: '#3b82f6',         // blue-500
  primaryDark: '#1e3a8a',          // blue-900

  // Input
  inputBg: '#ffffff',
  inputBorder: '#d1d5db',          // gray-300
  inputText: '#111827',            // gray-900
  placeholder: '#9ca3af',          // gray-400
};

export const darkTokens: ThemeTokens = {
  // Backgrounds
  background: '#0f172a',           // slate-900
  backgroundSecondary: '#1e293b',  // slate-800
  backgroundTertiary: '#334155',   // slate-700
  card: '#1e293b',                 // slate-800
  cardHover: '#334155',            // slate-700

  // Text
  text: '#f8fafc',                 // slate-50
  textSecondary: '#94a3b8',        // slate-400
  textMuted: '#64748b',            // slate-500
  textInverse: '#0f172a',          // slate-900

  // Borders
  border: '#334155',               // slate-700
  borderLight: '#475569',          // slate-600

  // Status (adjusted for dark mode visibility)
  success: '#22c55e',              // green-500
  successBg: '#14532d',            // green-900
  warning: '#f59e0b',              // amber-500
  warningBg: '#78350f',            // amber-900
  error: '#ef4444',                // red-500
  errorBg: '#7f1d1d',              // red-900
  info: '#3b82f6',                 // blue-500
  infoBg: '#1e3a8a',              // blue-900

  // Brand
  primary: '#3b82f6',              // blue-500
  primaryLight: '#60a5fa',         // blue-400
  primaryDark: '#1e40af',          // blue-800

  // Input
  inputBg: '#1e293b',             // slate-800
  inputBorder: '#475569',          // slate-600
  inputText: '#f8fafc',            // slate-50
  placeholder: '#64748b',          // slate-500
};

export function getThemeTokens(isDark: boolean): ThemeTokens {
  return isDark ? darkTokens : lightTokens;
}

/**
 * Status-specific colors for work orders, priorities, etc.
 * Consistent across themes for recognition.
 */
export const statusTokens = {
  // Work Order Status
  draft: { bg: '#f1f5f9', text: '#475569', border: '#cbd5e1' },
  scheduled: { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  traveling: { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  inProgress: { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
  onHold: { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  completed: { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  cancelled: { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },

  // Priority
  low: '#6b7280',       // gray-500
  medium: '#3b82f6',    // blue-500
  high: '#f59e0b',      // amber-500
  urgent: '#ef4444',    // red-500
};

export const statusTokensDark = {
  // Work Order Status (adjusted for dark backgrounds)
  draft: { bg: '#334155', text: '#94a3b8', border: '#475569' },
  scheduled: { bg: '#1e3a8a', text: '#93c5fd', border: '#3b82f6' },
  traveling: { bg: '#78350f', text: '#fcd34d', border: '#f59e0b' },
  inProgress: { bg: '#14532d', text: '#6ee7b7', border: '#22c55e' },
  onHold: { bg: '#831843', text: '#f9a8d4', border: '#ec4899' },
  completed: { bg: '#312e81', text: '#a5b4fc', border: '#6366f1' },
  cancelled: { bg: '#7f1d1d', text: '#fca5a5', border: '#ef4444' },

  // Priority (same, they're accent colors)
  low: '#9ca3af',       // gray-400
  medium: '#60a5fa',    // blue-400
  high: '#fbbf24',      // amber-400
  urgent: '#f87171',    // red-400
};

export function getStatusTokens(isDark: boolean) {
  return isDark ? statusTokensDark : statusTokens;
}
