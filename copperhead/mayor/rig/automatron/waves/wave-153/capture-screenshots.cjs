/**
 * Wave 153 Screenshot Capture — Theme Standardizer Phase 2
 * Verifies web app renders correctly with fo-* CSS variables
 */
const puppeteer = require('puppeteer');
const path = require('path');

const SCREENSHOTS = path.join(__dirname, 'screenshots');
const BASE = 'https://beta.numeruspro.com';

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Login via API
  const loginResp = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@fieldops.dev', password: 'FieldOps2024!' }),
  });
  const loginData = await loginResp.json();
  const token = loginData.data.accessToken;

  // Set token in browser
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((t) => localStorage.setItem('accessToken', t), token);

  // Dashboard
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: path.join(SCREENSHOTS, 'dashboard-light.png'), fullPage: false });
  console.log('Screenshot: dashboard-light.png');

  // Check CSS variables exist
  const cssVars = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      background: style.getPropertyValue('--fo-background').trim(),
      primary: style.getPropertyValue('--fo-primary').trim(),
      text: style.getPropertyValue('--fo-text').trim(),
    };
  });
  console.log('CSS vars found:', cssVars);

  // Work Orders page
  await page.goto(`${BASE}/work-orders`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: path.join(SCREENSHOTS, 'work-orders.png'), fullPage: false });
  console.log('Screenshot: work-orders.png');

  await browser.close();
  console.log('Done');
}

main().catch(e => { console.error(e); process.exit(1); });
