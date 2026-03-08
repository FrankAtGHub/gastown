/**
 * Wave 149 — Dark Theme Verification Tests
 *
 * Validates that all 6 wave-148 screens use useThemeStyles() instead of
 * hardcoded colors. These are static analysis tests — they read source
 * files and check for hardcoded color values.
 */
const fs = require('fs');
const path = require('path');

const SCREENS_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'apps', 'mobile', 'src', 'screens');

const SCREEN_FILES = [
  'PersonalInfoScreen.tsx',
  'MyVehicleScreen.tsx',
  'TimeEntriesListScreen.tsx',
  'DocumentsScreen.tsx',
  'NotificationsScreen.tsx',
  'HelpScreen.tsx',
];

// Hardcoded light-mode colors that should NOT appear in theme-integrated screens
const FORBIDDEN_COLORS = [
  '#f3f4f6',  // light background (should be colors.background)
  '#ffffff',  // white cards (should be colors.card)
  '#111827',  // dark text (should be colors.text)
  '#0f172a',  // darker text (should be colors.text)
  '#6b7280',  // secondary text (should be colors.textSecondary)
  '#1e40af',  // primary blue (should be colors.primary)
  '#e5e7eb',  // border (should be colors.border)
  '#d1d5db',  // input border (should be colors.inputBorder)
  '#9ca3af',  // muted/placeholder (should be colors.textMuted)
  '#f9fafb',  // alt background (should be colors.backgroundSecondary)
];

// Colors that ARE acceptable (status indicators, brand accents that don't change per theme)
const ALLOWED_COLORS = [
  '#16a34a',  // success green
  '#dc2626',  // error red
  '#f59e0b',  // warning amber
  '#22c55e',  // success green alt
  '#ef4444',  // error red alt
];

const results = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    results.push({ name, pass: true });
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    results.push({ name, pass: false, error: err.message });
  }
}

console.log('Wave 149 — Dark Theme Verification Tests\n');

// Test 1: All screens import useThemeStyles
for (const file of SCREEN_FILES) {
  test(`${file} imports useThemeStyles`, () => {
    const content = fs.readFileSync(path.join(SCREENS_DIR, file), 'utf-8');
    if (!content.includes('useThemeStyles')) {
      throw new Error('Missing import of useThemeStyles from theme');
    }
  });
}

// Test 2: All screens call useThemeStyles()
for (const file of SCREEN_FILES) {
  test(`${file} calls useThemeStyles()`, () => {
    const content = fs.readFileSync(path.join(SCREENS_DIR, file), 'utf-8');
    if (!content.match(/useThemeStyles\(\)/)) {
      throw new Error('useThemeStyles() is imported but never called');
    }
  });
}

// Test 3: No forbidden hardcoded colors remain
for (const file of SCREEN_FILES) {
  test(`${file} has no hardcoded light-mode colors`, () => {
    const content = fs.readFileSync(path.join(SCREENS_DIR, file), 'utf-8');
    const found = [];
    for (const color of FORBIDDEN_COLORS) {
      // Match color in style values (not in comments)
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        if (line.includes(color)) {
          found.push(`Line ${i + 1}: ${color} (${line.trim().substring(0, 60)})`);
        }
      }
    }
    if (found.length > 0) {
      throw new Error(`Found ${found.length} hardcoded colors:\n    ${found.slice(0, 5).join('\n    ')}${found.length > 5 ? `\n    ... and ${found.length - 5} more` : ''}`);
    }
  });
}

// Test 4: Screens use colors.* pattern
for (const file of SCREEN_FILES) {
  test(`${file} uses colors.* for styling`, () => {
    const content = fs.readFileSync(path.join(SCREENS_DIR, file), 'utf-8');
    const colorUsages = content.match(/colors\.\w+/g) || [];
    if (colorUsages.length < 3) {
      throw new Error(`Only ${colorUsages.length} colors.* references found — expected at least 3 for a themed screen`);
    }
  });
}

// Test 5: Reference screens still use useThemeStyles (regression check)
const REFERENCE_SCREENS = ['SettingsScreen.tsx', 'TruckInventoryScreen.tsx'];
for (const file of REFERENCE_SCREENS) {
  test(`${file} (reference) still uses useThemeStyles`, () => {
    const content = fs.readFileSync(path.join(SCREENS_DIR, file), 'utf-8');
    if (!content.includes('useThemeStyles')) {
      throw new Error('Reference screen lost useThemeStyles — regression!');
    }
  });
}

// Summary
const passed = results.filter(r => r.pass).length;
const total = results.length;
console.log(`\n${passed}/${total} tests passed`);

// Write results
const output = {
  wave: 149,
  phase: 'test-design',
  timestamp: new Date().toISOString(),
  tests: results,
  passed,
  total,
};

fs.writeFileSync(
  path.join(__dirname, '..', 'test-status-profile.json'),
  JSON.stringify(output, null, 2)
);

process.exit(passed === total ? 0 : 1);
