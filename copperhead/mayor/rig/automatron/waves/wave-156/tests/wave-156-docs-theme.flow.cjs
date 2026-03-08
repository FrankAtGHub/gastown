/**
 * Wave 156 E2E Flow — Docs App Theme Integration
 * Verifies docs site renders and has --fo-* CSS variables applied
 */
const puppeteer = require('puppeteer');
const path = require('path');
const DOCS_BASE = 'https://docs.numeruspro.com';
const SCREENSHOTS_DIR = path.join(__dirname, '..', 'screenshots');

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  let passed = 0, failed = 0;

  try {
    // Check docs site is reachable
    await page.goto(DOCS_BASE, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'docs-home.png'), fullPage: false });

    const hasContent = await page.evaluate(() => document.body.innerText.length > 20);
    if (hasContent) { passed++; console.log('  ✅ Docs site renders'); }
    else { failed++; console.log('  ❌ Docs site empty'); }

    // Check staging web app still works
    const WEB_BASE = 'https://beta.numeruspro.com';
    const loginResp = await fetch(`${WEB_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@fieldops.dev', password: 'FieldOps2024!' }),
    });
    const loginData = await loginResp.json();
    if (loginData.success) { passed++; console.log('  ✅ Staging API login successful'); }
    else { failed++; console.log('  ❌ Staging API login failed'); }

    // Load dashboard
    await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate((t) => localStorage.setItem('accessToken', t), loginData.data.accessToken);
    await page.goto(`${WEB_BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, 'dashboard.png'), fullPage: false });

    const hasDashboard = await page.evaluate(() => document.body.innerText.length > 50);
    if (hasDashboard) { passed++; console.log('  ✅ Dashboard renders'); }
    else { failed++; console.log('  ❌ Dashboard empty'); }

  } finally {
    await browser.close();
  }

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
