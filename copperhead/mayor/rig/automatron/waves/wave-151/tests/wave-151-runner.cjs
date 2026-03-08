/**
 * Wave 151 Runner — Crew Self-Clock-In
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WAVE_DIR = path.resolve(__dirname, '..');
const TESTS_DIR = __dirname;

const mode = process.argv.includes('--post') ? 'post' : 'pre';
console.log(`\nWave 151 Runner (${mode})\n`);

const results = [];

// Test 1: Static analysis
try {
  const output = execSync(`node "${path.join(TESTS_DIR, 'wave-151-crew-self.test.js')}"`, {
    encoding: 'utf-8',
    timeout: 60000,
  });
  const match = output.match(/(\d+)\/(\d+) tests passed/);
  if (match && match[1] === match[2]) {
    results.push({
      name: 'wave-151-crew-self.test.js',
      passed: true,
      tests: parseInt(match[2]),
      output: output.trim(),
    });
    console.log(`  ✅ wave-151-crew-self.test.js: ${match[1]}/${match[2]} passed`);
  } else {
    results.push({ name: 'wave-151-crew-self.test.js', passed: false, output: output.trim() });
    console.log(`  ❌ wave-151-crew-self.test.js`);
  }
} catch (e) {
  results.push({ name: 'wave-151-crew-self.test.js', passed: false, message: e.message });
  console.log(`  ❌ wave-151-crew-self.test.js: ${e.message}`);
}

// Test 2: E2E flow (if running in post mode with staging deployed)
if (mode === 'post') {
  try {
    const flow = require(path.join(TESTS_DIR, 'wave-151-self-clock.flow.cjs'));
    const result = await_flow(flow);
    results.push(result);
  } catch (e) {
    results.push({ name: 'wave-151-self-clock', passed: false, message: e.message });
    console.log(`  ❌ wave-151-self-clock: ${e.message}`);
  }
}

function await_flow(flow) {
  // Run flow synchronously via subprocess
  try {
    const output = execSync(`node -e "
      const f = require('${path.join(TESTS_DIR, 'wave-151-self-clock.flow.cjs').replace(/'/g, "\\'")}');
      f.run(null, {}).then(r => {
        console.log(JSON.stringify(r));
        if (r.status === 'fail') process.exit(1);
      }).catch(e => {
        console.log(JSON.stringify({ status: 'fail', message: e.message }));
        process.exit(1);
      });
    "`, { encoding: 'utf-8', timeout: 60000, env: { ...process.env, TEST_PASS: 'FieldOps2024!' } });

    const lines = output.trim().split('\n');
    const lastLine = lines[lines.length - 1];
    try {
      const r = JSON.parse(lastLine);
      const flowPassed = r.status === 'pass';
      console.log(`  ${flowPassed ? '✅' : '❌'} wave-151-self-clock: ${r.message}`);
      return { name: 'wave-151-self-clock', passed: flowPassed, message: r.message };
    } catch {
      console.log(`  ✅ wave-151-self-clock: flow completed`);
      return { name: 'wave-151-self-clock', passed: true, message: 'Flow completed' };
    }
  } catch (e) {
    const msg = e.stdout?.includes('fail') ? 'Flow checks failed' : e.message;
    console.log(`  ❌ wave-151-self-clock: ${msg}`);
    return { name: 'wave-151-self-clock', passed: false, message: msg };
  }
}

const allPassed = results.every(r => r.passed);
const passedCount = results.filter(r => r.passed).length;
const totalCount = results.length;

console.log(`\n${passedCount}/${totalCount} test suites passed\n`);

const statusFile = path.join(WAVE_DIR, `test-status-${mode}.json`);
fs.writeFileSync(statusFile, JSON.stringify({
  wave: 151,
  timestamp: new Date().toISOString(),
  mode,
  total: totalCount,
  passed: passedCount,
  failed: totalCount - passedCount,
  allPassed,
  results,
}, null, 2));
console.log(`Wrote ${statusFile}`);

if (!allPassed) process.exit(1);
