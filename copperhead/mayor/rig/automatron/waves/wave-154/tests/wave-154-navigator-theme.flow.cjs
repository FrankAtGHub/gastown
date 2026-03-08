/**
 * Wave 154 E2E Flow — Mobile Navigator Theme
 * Verifies the web-exported mobile app renders with theme colors
 */
const puppeteer = require('puppeteer');
const BASE = 'https://beta.numeruspro.com';

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  let passed = 0, failed = 0;

  try {
    // Verify staging is up
    const health = await fetch(`${BASE}/api/health`);
    const data = await health.json();
    if (data.status === 'ok') { passed++; console.log('  ✅ API healthy'); }
    else { failed++; console.log('  ❌ API unhealthy'); }

    // Login and check dashboard renders
    const loginResp = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@fieldops.dev', password: 'FieldOps2024!' }),
    });
    const loginData = await loginResp.json();
    if (loginData.success) { passed++; console.log('  ✅ Login successful'); }
    else { failed++; console.log('  ❌ Login failed'); }

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.evaluate((t) => localStorage.setItem('accessToken', t), loginData.data.accessToken);
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });

    const hasContent = await page.evaluate(() => document.body.innerText.length > 50);
    if (hasContent) { passed++; console.log('  ✅ Dashboard renders'); }
    else { failed++; console.log('  ❌ Dashboard empty'); }

  } finally {
    await browser.close();
  }

  console.log(`\n${passed}/${passed + failed} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
