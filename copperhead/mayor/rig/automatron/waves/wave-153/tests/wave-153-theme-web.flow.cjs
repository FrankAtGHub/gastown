/**
 * Wave 153 E2E Flow — Theme CSS Variables on Web
 *
 * Verifies CSS custom properties are injected and accessible
 * on the deployed web app at beta.numeruspro.com
 */
const puppeteer = require('puppeteer');

const BASE = 'https://beta.numeruspro.com';

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  let passed = 0;
  let failed = 0;

  try {
    // Login via API
    const loginResp = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@fieldops.dev', password: 'FieldOps2024!' }),
    });
    const loginData = await loginResp.json();
    const token = loginData.data.accessToken;

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate((t) => localStorage.setItem('accessToken', t), token);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });

    // Test 1: CSS variables exist in :root
    const vars = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        background: s.getPropertyValue('--fo-background').trim(),
        primary: s.getPropertyValue('--fo-primary').trim(),
        text: s.getPropertyValue('--fo-text').trim(),
        success: s.getPropertyValue('--fo-success').trim(),
        error: s.getPropertyValue('--fo-error').trim(),
      };
    });

    if (vars.background === '#f8fafc') { passed++; console.log('  ✅ --fo-background present'); }
    else { failed++; console.log(`  ❌ --fo-background: got "${vars.background}"`); }

    if (vars.primary === '#1e40af') { passed++; console.log('  ✅ --fo-primary present'); }
    else { failed++; console.log(`  ❌ --fo-primary: got "${vars.primary}"`); }

    if (vars.text === '#0f172a') { passed++; console.log('  ✅ --fo-text present'); }
    else { failed++; console.log(`  ❌ --fo-text: got "${vars.text}"`); }

    if (vars.success === '#16a34a') { passed++; console.log('  ✅ --fo-success present'); }
    else { failed++; console.log(`  ❌ --fo-success: got "${vars.success}"`); }

    if (vars.error === '#dc2626') { passed++; console.log('  ✅ --fo-error present'); }
    else { failed++; console.log(`  ❌ --fo-error: got "${vars.error}"`); }

    // Test 2: Page renders without errors
    const title = await page.title();
    if (title && title.length > 0) { passed++; console.log('  ✅ Page has title'); }
    else { failed++; console.log('  ❌ Page title missing'); }

    // Test 3: Dashboard content loads
    const hasContent = await page.evaluate(() => document.body.innerText.length > 100);
    if (hasContent) { passed++; console.log('  ✅ Dashboard content loaded'); }
    else { failed++; console.log('  ❌ Dashboard content empty'); }

  } finally {
    await browser.close();
  }

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
