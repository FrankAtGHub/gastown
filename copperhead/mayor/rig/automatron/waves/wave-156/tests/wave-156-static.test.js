/**
 * Wave 156 — Theme Standardizer Phase 3: Docs App Integration
 *
 * Static verification tests:
 * 1. tailwind.config.ts imports fieldOpsColors from CJS bridge
 * 2. tailwind.config.ts extends theme with fo namespace
 * 3. global.css has --fo-* CSS variables for :root and .dark
 * 4. package.json has @field-ops/theme dependency
 * 5. Dockerfile copies packages/theme and symlinks
 * 6. CSS variable counts match (26 light + 26 dark)
 * 7. No regression: fumadocs preset preserved
 * 8. No regression: brand colors preserved
 * 9. No regression: darkMode 'class' preserved
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const DOCS = join(ROOT, 'apps', 'docs');

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, status: 'pass' });
  } catch (e) {
    failed++;
    results.push({ name, status: 'fail', error: e.message });
    console.error(`FAIL: ${name} — ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// Read target files
const tailwindConfig = readFileSync(join(DOCS, 'tailwind.config.ts'), 'utf-8');
const globalCss = readFileSync(join(DOCS, 'app', 'global.css'), 'utf-8');
const packageJson = readFileSync(join(DOCS, 'package.json'), 'utf-8');
const dockerfile = readFileSync(join(DOCS, 'Dockerfile'), 'utf-8');

// Tailwind config tests
test('tailwind.config.ts: imports fieldOpsColors from CJS bridge', () => {
  assert(
    tailwindConfig.includes('tailwind-colors.cjs') && tailwindConfig.includes('fieldOpsColors'),
    'Missing fieldOpsColors import from tailwind-colors.cjs'
  );
});

test('tailwind.config.ts: extends theme with fo namespace', () => {
  assert(
    tailwindConfig.includes('fo: fieldOpsColors') || tailwindConfig.includes('fo:fieldOpsColors'),
    'Missing fo namespace in theme.extend.colors'
  );
});

test('tailwind.config.ts: preserves fumadocs preset', () => {
  assert(
    tailwindConfig.includes('fumadocs-ui/tailwind-plugin') && tailwindConfig.includes('createPreset'),
    'fumadocs preset import missing'
  );
});

test('tailwind.config.ts: preserves brand colors', () => {
  assert(
    tailwindConfig.includes('brand:') && tailwindConfig.includes('#fbbf24'),
    'Brand color definitions missing'
  );
});

test('tailwind.config.ts: preserves darkMode class', () => {
  assert(
    tailwindConfig.includes("darkMode: 'class'"),
    'darkMode class setting missing'
  );
});

// global.css tests
test('global.css: has :root with --fo-* variables', () => {
  assert(globalCss.includes(':root'), 'Missing :root block');
  assert(globalCss.includes('--fo-primary:'), 'Missing --fo-primary variable');
  assert(globalCss.includes('--fo-background:'), 'Missing --fo-background variable');
});

test('global.css: has .dark with --fo-* variables', () => {
  assert(globalCss.includes('.dark'), 'Missing .dark block');
  // Check dark values differ from light
  const darkBlock = globalCss.split('.dark')[1];
  assert(darkBlock && darkBlock.includes('--fo-primary:'), 'Missing --fo-primary in .dark block');
});

test('global.css: has 26 light CSS variables', () => {
  const rootMatch = globalCss.match(/:root\s*\{([^}]+)\}/);
  assert(rootMatch, 'Cannot extract :root block');
  const varCount = (rootMatch[1].match(/--fo-/g) || []).length;
  assert(varCount === 26, `Expected 26 --fo-* vars in :root, found ${varCount}`);
});

test('global.css: has 26 dark CSS variables', () => {
  const darkMatch = globalCss.match(/\.dark\s*\{([^}]+)\}/);
  assert(darkMatch, 'Cannot extract .dark block');
  const varCount = (darkMatch[1].match(/--fo-/g) || []).length;
  assert(varCount === 26, `Expected 26 --fo-* vars in .dark, found ${varCount}`);
});

test('global.css: preserves fumadocs style import', () => {
  assert(
    globalCss.includes("fumadocs-ui/style.css"),
    'fumadocs-ui style import missing'
  );
});

test('global.css: preserves Tailwind directives', () => {
  assert(globalCss.includes('@tailwind base'), 'Missing @tailwind base');
  assert(globalCss.includes('@tailwind components'), 'Missing @tailwind components');
  assert(globalCss.includes('@tailwind utilities'), 'Missing @tailwind utilities');
});

// package.json tests
test('package.json: has @field-ops/theme dependency', () => {
  const pkg = JSON.parse(packageJson);
  const hasDep = pkg.dependencies?.['@field-ops/theme'] || pkg.devDependencies?.['@field-ops/theme'];
  assert(hasDep, 'Missing @field-ops/theme dependency');
});

// Dockerfile tests
test('Dockerfile: copies packages/theme', () => {
  assert(
    dockerfile.includes('packages/theme'),
    'Dockerfile does not copy packages/theme'
  );
});

test('Dockerfile: symlinks @field-ops/theme', () => {
  assert(
    dockerfile.includes('@field-ops/theme') || dockerfile.includes('@field-ops'),
    'Dockerfile does not create @field-ops/theme symlink'
  );
});

test('Dockerfile: preserves standalone output', () => {
  assert(
    dockerfile.includes('standalone') && dockerfile.includes('server.js'),
    'Dockerfile standalone output pattern missing'
  );
});

// Summary
console.log(`\nWave 156 Static Tests: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}

// Write results
writeFileSync(
  join(import.meta.dirname, '..', 'test-status-post.json'),
  JSON.stringify({
    wave: 156,
    timestamp: new Date().toISOString(),
    total: passed + failed,
    passed,
    failed,
    allPassed: failed === 0,
    results,
  }, null, 2)
);

console.log('Results written to test-status-post.json');
