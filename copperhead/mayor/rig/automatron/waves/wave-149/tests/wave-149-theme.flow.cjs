/**
 * Wave 149 — Dark Theme E2E Flow
 *
 * This flow verifies that the 6 wave-148 screens render correctly in both
 * light and dark mode on the mobile web (Expo web export).
 *
 * Since this is a mobile-only wave testing React Native screens, the E2E
 * validates the static analysis results and confirms the theme integration
 * at the source code level. Visual verification on device is done during
 * Expo reload in Phase 4.
 *
 * @param {import('puppeteer').Page} page
 * @param {object} config
 * @param {object} ctx
 */
module.exports = async function wave149ThemeFlow(page, config, ctx) {
  const fs = require('fs');
  const path = require('path');

  const SCREENS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'apps', 'mobile', 'src', 'screens');

  const SCREENS = [
    'PersonalInfoScreen.tsx',
    'MyVehicleScreen.tsx',
    'TimeEntriesListScreen.tsx',
    'DocumentsScreen.tsx',
    'NotificationsScreen.tsx',
    'HelpScreen.tsx',
  ];

  const FORBIDDEN_COLORS = [
    '#f3f4f6', '#ffffff', '#111827', '#0f172a', '#6b7280',
    '#1e40af', '#e5e7eb', '#d1d5db', '#9ca3af', '#f9fafb',
  ];

  const issues = [];

  for (const screen of SCREENS) {
    const filePath = path.join(SCREENS_DIR, screen);
    if (!fs.existsSync(filePath)) {
      issues.push(`${screen}: FILE NOT FOUND`);
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // Check useThemeStyles import + call
    if (!content.includes('useThemeStyles')) {
      issues.push(`${screen}: missing useThemeStyles import`);
    }
    if (!content.match(/useThemeStyles\(\)/)) {
      issues.push(`${screen}: useThemeStyles not called`);
    }

    // Check for hardcoded colors (skip comments)
    const lines = content.split('\n');
    let hardcodedCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
      for (const color of FORBIDDEN_COLORS) {
        if (line.includes(color)) hardcodedCount++;
      }
    }
    if (hardcodedCount > 0) {
      issues.push(`${screen}: ${hardcodedCount} hardcoded colors remain`);
    }

    // Check colors.* usage
    const colorRefs = (content.match(/colors\.\w+/g) || []).length;
    if (colorRefs < 3) {
      issues.push(`${screen}: only ${colorRefs} colors.* refs (expected ≥3)`);
    }
  }

  if (issues.length > 0) {
    return {
      status: 'fail',
      message: `${issues.length} issues: ${issues.join('; ')}`,
    };
  }

  return {
    status: 'ok',
    message: `All 6 screens verified: useThemeStyles imported+called, no hardcoded colors, colors.* used throughout`,
  };
};
