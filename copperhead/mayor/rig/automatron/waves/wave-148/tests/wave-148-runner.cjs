#!/usr/bin/env node
/**
 * Wave 148 Test Runner — Mobile Sync Crash Fix + Profile Screen Completion
 *
 * Runs all wave-specific tests (API + E2E flows) and produces result artifacts.
 *
 * Usage:
 *   node automatron/waves/wave-148/tests/wave-148-runner.cjs [--pre|--post]
 *
 *   --pre   Save results to test-status-pre.json (before implementation — proves TDD)
 *   --post  Save results to test-status-post.json (after implementation — proves it works)
 *
 * Without flags, just prints results to stdout.
 */

'use strict';

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const WAVE_DIR = path.resolve(__dirname, '..');
const FLOW_DIR = __dirname;

const config = {
  APP_BASE_URL: process.env.APP_BASE_URL || 'http://localhost:3002',
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3001',
  TEST_USER: process.env.TEST_USER || 'admin@fieldops.dev',
  TEST_PASS: process.env.TEST_PASS,
  HEADLESS: process.env.HEADLESS !== 'false',
  SLOW_MO: parseInt(process.env.SLOW_MO || '0', 10),
};

const args = process.argv.slice(2);
const saveMode = args.includes('--pre') ? 'pre' : args.includes('--post') ? 'post' : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Discover flow files ---
function discoverFlows() {
  return fs
    .readdirSync(FLOW_DIR)
    .filter((f) => f.endsWith('.flow.cjs'))
    .sort();
}

// --- Login helper (API-based, no DOM typing) ---
// IMPORTANT: Do NOT use Puppeteer .type() for login — it causes double-typing
// when flows also handle auth. Use fetch-based login instead.
async function login(page, cfg) {
  const loginCfg = cfg || config;
  if (!loginCfg.TEST_PASS) {
    console.log('    WARN: TEST_PASS not set, skipping runner login');
    return false;
  }
  try {
    const result = await page.evaluate(async (c) => {
      const r = await fetch(`${c.API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: c.TEST_USER, password: c.TEST_PASS }),
      });
      const data = await r.json();
      if (data.success && data.data && data.data.accessToken) {
        localStorage.setItem('accessToken', data.data.accessToken);
        if (data.data.refreshToken) localStorage.setItem('refreshToken', data.data.refreshToken);
        return { ok: true };
      }
      return { ok: false, message: data.message || `HTTP ${r.status}` };
    }, loginCfg);
    if (!result.ok) {
      console.log(`    WARN: Runner login failed: ${result.message}`);
      return false;
    }
    return true;
  } catch (err) {
    console.log(`    WARN: Runner login error: ${err.message}`);
    return false;
  }
}

// --- API test helper ---
async function runAPITests() {
  // Find .test.js files and run them with Jest
  const testFiles = fs.readdirSync(FLOW_DIR).filter((f) => f.endsWith('.test.js'));
  const results = [];

  if (testFiles.length === 0) return results;

  const { execSync } = require('child_process');
  const apiDir = path.resolve(WAVE_DIR, '..', '..', 'apps', 'api');

  for (const tf of testFiles) {
    const testPath = path.join(FLOW_DIR, tf);
    try {
      // Run as standalone Node script (these tests use their own test harness, not Jest)
      const output = execSync(`node "${testPath}"`, {
        encoding: 'utf-8',
        timeout: 60000,
        env: { ...process.env, NODE_ENV: 'test' },
      });
      const match = output.match(/(\d+)\/(\d+) tests passed/);
      const passed = match ? parseInt(match[1], 10) : 0;
      const total = match ? parseInt(match[2], 10) : 0;
      results.push({
        name: tf,
        passed: passed === total && total > 0,
        tests: total,
        output: output.slice(-500),
      });
    } catch (err) {
      results.push({
        name: tf,
        passed: false,
        tests: 0,
        output: (err.stdout || err.message || '').slice(-500),
      });
    }
  }

  return results;
}

// --- Main ---
async function main() {
  console.log(`\n  Wave 148 Test Runner — Mobile Sync Crash Fix + Profile Screen Completion`);
  console.log(`  Mode: ${saveMode ? saveMode + '-implementation' : 'stdout only'}`);
  console.log(`  Headless: ${config.HEADLESS}\n`);

  const flows = discoverFlows();
  const allResults = [];
  let browser, page;

  // --- E2E Flows ---
  if (flows.length > 0) {
    console.log(`  Running ${flows.length} E2E flow(s)...`);

    browser = await puppeteer.launch({
      headless: config.HEADLESS ? 'new' : false,
      slowMo: config.SLOW_MO,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1440,900',
      ],
      defaultViewport: { width: 1440, height: 900 },
    });

    page = await browser.newPage();
    // Navigate to app so localStorage is on the right origin
    await page.goto(config.APP_BASE_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await login(page);

    // Flows handle their own auth if they need a different user.
    // config is passed so flows can call the login helper or do their own fetch.
    const ctx = { login }; // shared context across flows — includes login helper

    for (const flowFile of flows) {
      const flowName = flowFile.replace('.flow.cjs', '');
      try {
        const flowFn = require(path.join(FLOW_DIR, flowFile));
        const result = await flowFn(page, config, ctx);
        const status = result?.status || 'ok';
        allResults.push({ name: flowName, passed: status === 'ok', message: result?.message || '' });
        console.log(`    ${status === 'ok' ? 'OK' : 'FAIL'} — ${flowName}: ${result?.message || ''}`);
      } catch (err) {
        allResults.push({ name: flowName, passed: false, message: err.message });
        console.log(`    FAIL — ${flowName}: ${err.message}`);

        // Screenshot on failure
        try {
          const ssPath = path.join(WAVE_DIR, 'screenshots', `${flowName}-fail.png`);
          await page.screenshot({ path: ssPath, fullPage: true });
          console.log(`    Screenshot: ${ssPath}`);
        } catch { /* ignore screenshot errors */ }
      }
    }

    await browser.close();
  }

  // --- API Tests ---
  console.log('\n  Running API tests...');
  const apiResults = await runAPITests();
  for (const r of apiResults) {
    allResults.push(r);
    console.log(`    ${r.passed ? 'OK' : 'FAIL'} — ${r.name} (${r.tests} tests)`);
  }

  // --- Summary ---
  const total = allResults.length;
  const passed = allResults.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`\n  Total: ${total}, Passed: ${passed}, Failed: ${failed}`);
  console.log(`  Status: ${failed === 0 ? 'ALL PASSING' : 'FAILURES DETECTED'}\n`);

  // --- Save artifact ---
  if (saveMode) {
    const artifact = {
      wave: 148,
      timestamp: new Date().toISOString(),
      mode: saveMode,
      total,
      passed,
      failed,
      allPassed: failed === 0,
      results: allResults,
    };

    const artifactPath = path.join(WAVE_DIR, `test-status-${saveMode}.json`);
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');
    console.log(`  Saved: ${artifactPath}\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Runner crashed:', err.message);
  process.exit(1);
});
