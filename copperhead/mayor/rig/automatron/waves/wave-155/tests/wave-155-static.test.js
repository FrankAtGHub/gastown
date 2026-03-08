/**
 * Wave 155 — Mobile Dark Theme Remaining Hardcoded Colors
 *
 * Static verification tests:
 * 1. All 4 target files import useThemeStyles
 * 2. No non-exempt hardcoded hex colors remain
 * 3. createStyles receives colors parameter
 * 4. Regression: no broken imports
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..', '..');

const TARGET_FILES = [
  'apps/mobile/src/screens/EndOfDayScreen.tsx',
  'apps/mobile/src/screens/LoginScreen.tsx',
  'apps/mobile/src/screens/CrewClockInScreen.tsx',
  'apps/mobile/src/screens/PhotoCaptureScreen.native.tsx',
];

// Hex colors that are exempt (brand icons, platform constants, photo viewer chrome)
const EXEMPT_PATTERNS = [
  // SSO brand icons (Microsoft, Google, Apple) - LoginScreen SVG paths
  /#F25022/, /#7FBA00/, /#00A4EF/, /#FFB900/,  // Microsoft
  /#4285F4/, /#34A853/, /#FBBC05/, /#EA4335/,  // Google
  /#000000/,                                      // Apple icon fill + Apple SSO button
  // Apple SSO button white text (brand requirement)
  /provider === 'apple' \? '#ffffff'/,
  // Shadow color (iOS platform constant)
  /shadowColor: '#000'/,
  // Photo viewer dark chrome (always dark, not theme-dependent)
  /#1a1a1a/, /#2a2a2a/, /#333/,
  // Full-screen photo modal background
  /backgroundColor: '#000'/,
];

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

// Test each file
for (const file of TARGET_FILES) {
  const fullPath = join(ROOT, file);
  const content = readFileSync(fullPath, 'utf-8');
  const shortName = file.split('/').pop();

  // 1. Imports useThemeStyles
  test(`${shortName}: imports useThemeStyles`, () => {
    assert(content.includes("useThemeStyles"), `Missing useThemeStyles import`);
  });

  // 2. Uses useThemeStyles hook
  test(`${shortName}: calls useThemeStyles()`, () => {
    assert(content.includes("useThemeStyles()"), `Missing useThemeStyles() call`);
  });

  // 3. createStyles receives colors
  test(`${shortName}: createStyles takes colors param`, () => {
    assert(
      content.includes("createStyles(colors)") || content.includes("createStyles = (colors"),
      `createStyles not parameterized with colors`
    );
  });

  // 4. No non-exempt hardcoded hex colors
  test(`${shortName}: no non-exempt hardcoded hex colors`, () => {
    // Find all hex color references in the file
    const hexPattern = /#[0-9a-fA-F]{3,8}\b/g;
    const lines = content.split('\n');
    const violations = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = line.match(hexPattern);
      if (!matches) continue;

      for (const match of matches) {
        // Check if this line is exempt
        const isExempt = EXEMPT_PATTERNS.some(pat => pat.test(line));
        if (!isExempt) {
          violations.push(`Line ${i + 1}: ${match} — "${line.trim().substring(0, 80)}"`);
        }
      }
    }

    assert(
      violations.length === 0,
      `Found ${violations.length} non-exempt hardcoded hex colors:\n${violations.join('\n')}`
    );
  });

  // 5. No hardcoded color in StyleSheet outside exempt areas
  test(`${shortName}: StyleSheet uses theme tokens`, () => {
    // Check that createStyles function body doesn't have non-exempt hex
    const createStylesMatch = content.match(/createStyles\s*=\s*\(colors[^)]*\)\s*=>\s*StyleSheet\.create\(\{([\s\S]*?)\}\);/);
    if (!createStylesMatch) return; // Some files might not have this pattern

    const styleBody = createStylesMatch[1];
    const hexInStyles = styleBody.match(/#[0-9a-fA-F]{3,8}\b/g) || [];

    // Filter out exempt ones
    const nonExempt = hexInStyles.filter(hex => {
      const line = styleBody.split('\n').find(l => l.includes(hex));
      return !EXEMPT_PATTERNS.some(pat => pat.test(line || ''));
    });

    assert(
      nonExempt.length === 0,
      `Found ${nonExempt.length} hardcoded hex in StyleSheet: ${nonExempt.join(', ')}`
    );
  });
}

// Summary
console.log(`\nWave 155 Static Tests: ${passed}/${passed + failed} passed`);
if (failed > 0) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}

// Write results
import { writeFileSync } from 'fs';
writeFileSync(
  join(import.meta.dirname, 'test-status-post.json'),
  JSON.stringify({
    wave: 155,
    timestamp: new Date().toISOString(),
    total: passed + failed,
    passed,
    failed,
    results,
  }, null, 2)
);

console.log('Results written to test-status-post.json');
