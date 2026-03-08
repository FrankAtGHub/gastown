/**
 * Wave 153 — Theme Standardizer Phase 2 Tests
 *
 * Verifies:
 * 1. Tailwind preset files exist and are correct
 * 2. CSS variables injected in input.css
 * 3. Tailwind config uses shared theme tokens
 * 4. Package exports updated
 * 5. Token values match between CSS vars and source tokens
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../../');
const THEME_PKG = path.join(ROOT, 'packages/theme');
const WEB_APP = path.join(ROOT, 'apps/web');

let passed = 0;
let failed = 0;
const total = 22;

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

console.log('\nWave 153 — Theme Standardizer Phase 2 Tests\n');

// --- Package Files ---
console.log('Theme Package:');

test('tailwind-preset.ts exists', () => {
  assert(fs.existsSync(path.join(THEME_PKG, 'src/tailwind-preset.ts')));
});

test('css-variables.ts exists', () => {
  assert(fs.existsSync(path.join(THEME_PKG, 'src/css-variables.ts')));
});

test('tailwind-colors.cjs exists', () => {
  assert(fs.existsSync(path.join(THEME_PKG, 'tailwind-colors.cjs')));
});

test('tailwind-preset exports fieldOpsColors', () => {
  const src = readFile(path.join(THEME_PKG, 'src/tailwind-preset.ts'));
  assert(src.includes('fieldOpsColors'), 'Missing fieldOpsColors export');
});

test('tailwind-preset exports fieldOpsPreset', () => {
  const src = readFile(path.join(THEME_PKG, 'src/tailwind-preset.ts'));
  assert(src.includes('fieldOpsPreset'), 'Missing fieldOpsPreset export');
});

test('css-variables exports generateCssVariableSheet', () => {
  const src = readFile(path.join(THEME_PKG, 'src/css-variables.ts'));
  assert(src.includes('generateCssVariableSheet'), 'Missing generateCssVariableSheet');
});

test('css-variables exports cssVarNames', () => {
  const src = readFile(path.join(THEME_PKG, 'src/css-variables.ts'));
  assert(src.includes('cssVarNames'), 'Missing cssVarNames');
});

test('index.ts re-exports css-variables', () => {
  const src = readFile(path.join(THEME_PKG, 'src/index.ts'));
  assert(src.includes('css-variables'), 'Missing css-variables re-export');
});

test('index.ts re-exports tailwind-preset', () => {
  const src = readFile(path.join(THEME_PKG, 'src/index.ts'));
  assert(src.includes('tailwind-preset'), 'Missing tailwind-preset re-export');
});

test('package.json has tailwind-preset export path', () => {
  const pkg = JSON.parse(readFile(path.join(THEME_PKG, 'package.json')));
  assert(pkg.exports['./tailwind-preset'], 'Missing ./tailwind-preset export');
});

test('package.json has css-variables export path', () => {
  const pkg = JSON.parse(readFile(path.join(THEME_PKG, 'package.json')));
  assert(pkg.exports['./css-variables'], 'Missing ./css-variables export');
});

// --- CJS Color Map ---
console.log('\nCJS Color Map:');

test('tailwind-colors.cjs loads without error', () => {
  const { fieldOpsColors } = require(path.join(THEME_PKG, 'tailwind-colors.cjs'));
  assert(typeof fieldOpsColors === 'object', 'fieldOpsColors is not an object');
});

test('tailwind-colors has all 26 tokens', () => {
  const { fieldOpsColors } = require(path.join(THEME_PKG, 'tailwind-colors.cjs'));
  assert(Object.keys(fieldOpsColors).length === 26, `Expected 26 tokens, got ${Object.keys(fieldOpsColors).length}`);
});

test('tailwind-colors values use CSS variables', () => {
  const { fieldOpsColors } = require(path.join(THEME_PKG, 'tailwind-colors.cjs'));
  assert(fieldOpsColors.background === 'var(--fo-background)', 'background should be var(--fo-background)');
  assert(fieldOpsColors.primary === 'var(--fo-primary)', 'primary should be var(--fo-primary)');
});

// --- Web App Integration ---
console.log('\nWeb App Integration:');

test('tailwind.config.cjs imports fieldOpsColors', () => {
  const cfg = readFile(path.join(WEB_APP, 'tailwind.config.cjs'));
  assert(cfg.includes('fieldOpsColors'), 'Missing fieldOpsColors import');
});

test('tailwind.config.cjs extends colors with fo namespace', () => {
  const cfg = readFile(path.join(WEB_APP, 'tailwind.config.cjs'));
  assert(cfg.includes("fo:") || cfg.includes('fo:'), 'Missing fo namespace in colors');
});

test('tailwind.config.cjs loads successfully', () => {
  const cfg = require(path.join(WEB_APP, 'tailwind.config.cjs'));
  assert(cfg.theme.extend.colors.fo, 'Missing fo colors in loaded config');
  assert(Object.keys(cfg.theme.extend.colors.fo).length === 26, 'Expected 26 fo colors');
});

test('input.css has light theme CSS variables', () => {
  const css = readFile(path.join(WEB_APP, 'src/input.css'));
  assert(css.includes('--fo-background: #f8fafc'), 'Missing light background variable');
  assert(css.includes('--fo-primary: #1e40af'), 'Missing light primary variable');
  assert(css.includes('--fo-text: #0f172a'), 'Missing light text variable');
});

test('input.css has dark theme CSS variables', () => {
  const css = readFile(path.join(WEB_APP, 'src/input.css'));
  assert(css.includes('--fo-background: #0f172a'), 'Missing dark background variable');
  assert(css.includes('--fo-primary: #3b82f6'), 'Missing dark primary variable');
  assert(css.includes('--fo-text: #f8fafc'), 'Missing dark text variable');
});

// --- Regression ---
console.log('\nRegression:');

test('tailwind.config.cjs still has darkMode class', () => {
  const cfg = readFile(path.join(WEB_APP, 'tailwind.config.cjs'));
  assert(cfg.includes("darkMode: 'class'"), 'Missing darkMode class');
});

test('input.css still has scrollbar styles', () => {
  const css = readFile(path.join(WEB_APP, 'src/input.css'));
  assert(css.includes('scrollbar-hide'), 'Missing scrollbar-hide class');
  assert(css.includes('scrollbar-thin'), 'Missing scrollbar-thin class');
});

test('tokens.ts still exports original tokens', () => {
  const src = readFile(path.join(THEME_PKG, 'src/tokens.ts'));
  assert(src.includes('lightTokens'), 'Missing lightTokens');
  assert(src.includes('darkTokens'), 'Missing darkTokens');
  assert(src.includes('statusTokens'), 'Missing statusTokens');
});

console.log(`\n${passed}/${total} tests passed\n`);

if (failed > 0) process.exit(1);
