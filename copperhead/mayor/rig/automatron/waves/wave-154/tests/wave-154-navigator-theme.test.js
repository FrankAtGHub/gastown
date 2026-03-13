/**
 * Wave 154 — Mobile Dark Theme Navigator Fix Tests
 *
 * Verifies:
 * 1. AppNavigator uses useThemeStyles
 * 2. No hardcoded color hex values in AppNavigator
 * 3. ProfileScreen uses theme colors
 * 4. Package.json has @field-ops/theme dependency
 * 5. Metro config resolves @field-ops/theme
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../../');
const NAV = path.join(ROOT, 'apps/mobile/src/navigation/AppNavigator.js');
const PROFILE = path.join(ROOT, 'apps/mobile/src/screens/ProfileScreen.js');
const PKG = path.join(ROOT, 'apps/mobile/package.json');
const METRO = path.join(ROOT, 'apps/mobile/metro.config.js');

let passed = 0;
let failed = 0;
const total = 18;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function readFile(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

console.log('\nWave 154 — Mobile Dark Theme Navigator Fix Tests\n');

// --- AppNavigator ---
console.log('AppNavigator:');
const nav = readFile(NAV);

test('AppNavigator imports useThemeStyles', () => {
  assert(nav.includes('useThemeStyles'), 'Missing useThemeStyles import');
});

test('AppNavigator imports DefaultTheme and DarkTheme', () => {
  assert(nav.includes('DefaultTheme') && nav.includes('DarkTheme'), 'Missing navigation theme imports');
});

test('AppNavigator uses colors.primary for tab bar', () => {
  assert(nav.includes('colors.primary'), 'Missing colors.primary');
});

test('AppNavigator uses colors.card for tab bar background', () => {
  assert(nav.includes('colors.card'), 'Missing colors.card');
});

test('AppNavigator uses colors.border for tab bar border', () => {
  assert(nav.includes('colors.border'), 'Missing colors.border');
});

test('AppNavigator uses colors.textMuted for inactive tint', () => {
  assert(nav.includes('colors.textMuted'), 'Missing colors.textMuted');
});

test('AppNavigator creates themed navigation theme', () => {
  assert(nav.includes('navTheme'), 'Missing navTheme variable');
});

test('AppNavigator passes theme to NavigationContainer', () => {
  assert(nav.includes('theme={navTheme}') || nav.includes('theme={nav'), 'Missing theme prop on NavigationContainer');
});

test('No hardcoded #1e40af in AppNavigator', () => {
  // Allow in comments but not in active code
  const lines = nav.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const hardcoded = lines.filter(l => l.includes("'#1e40af'") || l.includes('"#1e40af"'));
  assert(hardcoded.length === 0, `Found ${hardcoded.length} hardcoded #1e40af`);
});

test('No hardcoded #ffffff backgroundColor in AppNavigator', () => {
  const lines = nav.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
  const hardcoded = lines.filter(l => (l.includes("'#ffffff'") || l.includes('"#ffffff"')) && l.includes('background'));
  assert(hardcoded.length === 0, `Found ${hardcoded.length} hardcoded #ffffff background`);
});

test('AppNavigator uses themedHeader for stack screens', () => {
  assert(nav.includes('themedHeader') || nav.includes('...themedHeader'), 'Missing themedHeader usage');
});

// --- ProfileScreen ---
console.log('\nProfileScreen:');
const profile = readFile(PROFILE);

test('ProfileScreen imports useThemeStyles', () => {
  assert(profile.includes('useThemeStyles'), 'Missing useThemeStyles import');
});

test('ProfileScreen uses colors from theme', () => {
  assert(profile.includes('colors.background') || profile.includes('colors.card') || profile.includes('colors.text'),
    'Missing theme color usage');
});

// --- Package Config ---
console.log('\nPackage Config:');

test('package.json has @field-ops/theme dependency', () => {
  const pkg = readFile(PKG);
  assert(pkg.includes('@field-ops/theme'), 'Missing @field-ops/theme dependency');
});

test('metro.config.js resolves @field-ops/theme', () => {
  const metro = readFile(METRO);
  assert(metro.includes('@field-ops/theme'), 'Missing @field-ops/theme resolution');
});

// --- Regression ---
console.log('\nRegression:');

test('AppNavigator still uses navigationRef', () => {
  assert(nav.includes('navigationRef'), 'Missing navigationRef');
});

test('AppNavigator still has all tab screens', () => {
  assert(nav.includes('Dashboard') && nav.includes('WorkOrders'), 'Missing tab screens');
});

test('AppNavigator still has auth check', () => {
  assert(nav.includes('isAuthenticated'), 'Missing auth check');
});

console.log(`\n${passed}/${total} tests passed\n`);

if (failed > 0) process.exit(1);
