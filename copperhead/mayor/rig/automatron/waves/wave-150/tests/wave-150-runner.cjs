/**
 * Wave 150 Runner — Theme Standardizer Phase 1
 *
 * Runs:
 * 1. wave-150-tokens.test.js — static analysis of token extraction
 * 2. wave-150-build.flow.cjs — build verification
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WAVE_DIR = path.resolve(__dirname, '..');
const TESTS_DIR = __dirname;

const mode = process.argv.includes('--post') ? 'post' : 'pre';
console.log(`\nWave 150 Runner (${mode})\n`);

const results = [];

// Test 1: Token extraction tests
try {
  const output = execSync(`node "${path.join(TESTS_DIR, 'wave-150-tokens.test.js')}"`, {
    encoding: 'utf-8',
    timeout: 60000,
  });
  const match = output.match(/(\d+)\/(\d+) tests passed/);
  if (match && match[1] === match[2]) {
    results.push({
      name: 'wave-150-tokens.test.js',
      passed: true,
      tests: parseInt(match[2]),
      output: output.trim(),
    });
    console.log(`  ✅ wave-150-tokens.test.js: ${match[1]}/${match[2]} passed`);
  } else {
    results.push({
      name: 'wave-150-tokens.test.js',
      passed: false,
      output: output.trim(),
    });
    console.log(`  ❌ wave-150-tokens.test.js: ${output.trim()}`);
  }
} catch (e) {
  results.push({
    name: 'wave-150-tokens.test.js',
    passed: false,
    message: e.message,
  });
  console.log(`  ❌ wave-150-tokens.test.js: ${e.message}`);
}

// Test 2: Build flow
try {
  const flow = require(path.join(TESTS_DIR, 'wave-150-build.flow.cjs'));
  // Run synchronously by importing
  const output = execSync(`node "${path.join(TESTS_DIR, 'wave-150-build.flow.cjs')}"`, {
    encoding: 'utf-8',
    timeout: 60000,
  });
  const match = output.match(/(\d+)\/(\d+) checks passed/);
  if (match && match[1] === match[2]) {
    results.push({
      name: 'wave-150-build',
      passed: true,
      message: `All ${match[2]} build checks passed`,
    });
    console.log(`  ✅ wave-150-build: ${match[1]}/${match[2]} checks passed`);
  } else {
    results.push({
      name: 'wave-150-build',
      passed: false,
      output: output.trim(),
    });
    console.log(`  ❌ wave-150-build: ${output.trim()}`);
  }
} catch (e) {
  results.push({
    name: 'wave-150-build',
    passed: false,
    message: e.message,
  });
  console.log(`  ❌ wave-150-build: ${e.message}`);
}

const allPassed = results.every(r => r.passed);
const total = results.length;
const passedCount = results.filter(r => r.passed).length;

console.log(`\n${passedCount}/${total} test suites passed\n`);

// Write test-status file
const statusFile = path.join(WAVE_DIR, `test-status-${mode}.json`);
fs.writeFileSync(statusFile, JSON.stringify({
  wave: 150,
  timestamp: new Date().toISOString(),
  mode,
  total,
  passed: passedCount,
  failed: total - passedCount,
  allPassed,
  results,
}, null, 2));
console.log(`Wrote ${statusFile}`);

if (!allPassed) process.exit(1);
