const puppeteer = require('puppeteer');
const path = require('path');
const BASE = 'https://beta.numeruspro.com';
const SCREENSHOTS = path.join(__dirname, 'screenshots');

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const loginResp = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@fieldops.dev', password: 'FieldOps2024!' }),
  });
  const loginData = await loginResp.json();
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((t) => localStorage.setItem('accessToken', t), loginData.data.accessToken);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: path.join(SCREENSHOTS, 'web-dashboard.png'), fullPage: false });
  console.log('Screenshot: web-dashboard.png');

  await page.goto(`${BASE}/work-orders`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: path.join(SCREENSHOTS, 'work-orders.png'), fullPage: false });
  console.log('Screenshot: work-orders.png');

  await browser.close();
  console.log('Done');
}

main().catch(e => { console.error(e); process.exit(1); });
