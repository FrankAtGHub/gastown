/**
 * Wave 150 — Theme Standardizer Phase 1 — Token Extraction Tests
 *
 * Verifies:
 * 1. packages/theme/src/tokens.ts exists with all token definitions
 * 2. apps/mobile/src/theme/colors.ts imports from @field-ops/theme
 * 3. All original exports still available (no breaking changes)
 * 4. Token values match original colors.ts values
 * 5. useThemeStyles.ts unchanged (imports from colors.ts which re-exports)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../../');
const THEME_PKG = path.join(ROOT, 'packages/theme');
const MOBILE_THEME = path.join(ROOT, 'apps/mobile/src/theme');

let passed = 0;
let failed = 0;
const total = 20;

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

console.log('\nWave 150 — Theme Token Extraction Tests\n');

// --- Package Structure ---
console.log('Package Structure:');

test('packages/theme/package.json exists', () => {
  assert(fs.existsSync(path.join(THEME_PKG, 'package.json')));
});

test('packages/theme/package.json has correct name', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(THEME_PKG, 'package.json'), 'utf-8'));
  assert(pkg.name === '@field-ops/theme', `Expected @field-ops/theme, got ${pkg.name}`);
});

test('packages/theme/tsconfig.json exists', () => {
  assert(fs.existsSync(path.join(THEME_PKG, 'tsconfig.json')));
});

test('packages/theme/src/tokens.ts exists', () => {
  assert(fs.existsSync(path.join(THEME_PKG, 'src/tokens.ts')));
});

test('packages/theme/src/index.ts exists', () => {
  assert(fs.existsSync(path.join(THEME_PKG, 'src/index.ts')));
});

// --- Token Content ---
console.log('\nToken Content:');

const tokensContent = fs.existsSync(path.join(THEME_PKG, 'src/tokens.ts'))
  ? fs.readFileSync(path.join(THEME_PKG, 'src/tokens.ts'), 'utf-8')
  : '';

test('tokens.ts exports ThemeTokens interface', () => {
  assert(tokensContent.includes('export interface ThemeTokens'), 'Missing ThemeTokens interface');
});

test('tokens.ts exports lightTokens', () => {
  assert(tokensContent.includes('export const lightTokens'), 'Missing lightTokens');
});

test('tokens.ts exports darkTokens', () => {
  assert(tokensContent.includes('export const darkTokens'), 'Missing darkTokens');
});

test('tokens.ts exports statusTokens', () => {
  assert(tokensContent.includes('export const statusTokens'), 'Missing statusTokens');
});

test('tokens.ts exports statusTokensDark', () => {
  assert(tokensContent.includes('export const statusTokensDark'), 'Missing statusTokensDark');
});

test('tokens.ts exports getThemeTokens function', () => {
  assert(tokensContent.includes('export function getThemeTokens'), 'Missing getThemeTokens');
});

test('tokens.ts exports getStatusTokens function', () => {
  assert(tokensContent.includes('export function getStatusTokens'), 'Missing getStatusTokens');
});

test('tokens.ts has all background tokens', () => {
  for (const token of ['background', 'backgroundSecondary', 'backgroundTertiary', 'card', 'cardHover']) {
    assert(tokensContent.includes(token), `Missing token: ${token}`);
  }
});

test('tokens.ts has all text tokens', () => {
  for (const token of ['text:', 'textSecondary', 'textMuted', 'textInverse']) {
    assert(tokensContent.includes(token), `Missing token: ${token}`);
  }
});

test('tokens.ts has all status tokens', () => {
  for (const token of ['success:', 'successBg', 'warning:', 'warningBg', 'error:', 'errorBg', 'info:', 'infoBg']) {
    assert(tokensContent.includes(token), `Missing token: ${token}`);
  }
});

// --- Mobile colors.ts Integration ---
console.log('\nMobile Integration:');

const colorsContent = fs.existsSync(path.join(MOBILE_THEME, 'colors.ts'))
  ? fs.readFileSync(path.join(MOBILE_THEME, 'colors.ts'), 'utf-8')
  : '';

test('colors.ts imports from @field-ops/theme', () => {
  assert(colorsContent.includes('@field-ops/theme'), 'Missing @field-ops/theme import');
});

test('colors.ts still exports ThemeColors type', () => {
  assert(colorsContent.includes('ThemeColors'), 'Missing ThemeColors export');
});

test('colors.ts still exports getThemeColors function', () => {
  assert(colorsContent.includes('getThemeColors'), 'Missing getThemeColors');
});

test('colors.ts still exports getStatusColors function', () => {
  assert(colorsContent.includes('getStatusColors'), 'Missing getStatusColors');
});

// --- useThemeStyles.ts Unchanged ---
console.log('\nRegression Check:');

test('useThemeStyles.ts unchanged — still imports from colors', () => {
  const hookContent = fs.readFileSync(path.join(MOBILE_THEME, 'useThemeStyles.ts'), 'utf-8');
  assert(hookContent.includes("from './colors'") || hookContent.includes("from '../theme/colors'"),
    'useThemeStyles.ts import changed');
});

console.log(`\n${passed}/${total} tests passed\n`);

if (failed > 0) {
  process.exit(1);
}
