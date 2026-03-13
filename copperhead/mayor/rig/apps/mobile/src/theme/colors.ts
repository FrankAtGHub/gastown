/**
 * Theme Colors for React Native
 *
 * Re-exports shared tokens from @field-ops/theme with mobile-specific
 * extensions (statusBarBg, statusBarStyle).
 *
 * Usage:
 *   const { isDark } = useTheme();
 *   const colors = getThemeColors(isDark);
 *
 *   <View style={{ backgroundColor: colors.background }}>
 */

import {
  ThemeTokens,
  lightTokens,
  darkTokens,
  statusTokens,
  statusTokensDark,
  getStatusTokens,
} from '@field-ops/theme';

// Mobile-specific extension: adds StatusBar properties
export interface ThemeColors extends ThemeTokens {
  statusBarBg: string;
  statusBarStyle: 'light-content' | 'dark-content';
}

export const lightColors: ThemeColors = {
  ...lightTokens,
  statusBarBg: '#1e40af',
  statusBarStyle: 'light-content',
};

export const darkColors: ThemeColors = {
  ...darkTokens,
  statusBarBg: '#0f172a',
  statusBarStyle: 'light-content',
};

/**
 * Get theme colors based on isDark flag
 */
export function getThemeColors(isDark: boolean): ThemeColors {
  return isDark ? darkColors : lightColors;
}

/**
 * Status-specific colors for work orders, priorities, etc.
 * These are consistent across themes for recognition.
 */
export const statusColors = statusTokens;

/**
 * Dark mode versions of status colors
 */
export const statusColorsDark = statusTokensDark;

/**
 * Get status colors based on isDark flag
 */
export function getStatusColors(isDark: boolean) {
  return getStatusTokens(isDark);
}
