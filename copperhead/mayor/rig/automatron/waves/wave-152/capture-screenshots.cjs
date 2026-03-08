/**
 * Wave 152 Screenshot Capture — QR Clock-In API verification
 * Captures: web dashboard (proof of D03 gate pass) + API responses
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const SCREENSHOTS = path.join(__dirname, 'screenshots');
const BASE = 'https://beta.numeruspro.com';

async function main() {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // 1. Login via API
  const loginResp = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@fieldops.dev', password: 'FieldOps2024!' }),
  });
  const loginData = await loginResp.json();
  const token = loginData.data.accessToken;
  console.log('Logged in');

  // Set token in browser
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((t) => localStorage.setItem('accessToken', t), token);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: path.join(SCREENSHOTS, 'web-dashboard.png'), fullPage: false });
  console.log('Screenshot: web-dashboard.png');

  // 2. Navigate to work orders
  await page.goto(`${BASE}/work-orders`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: path.join(SCREENSHOTS, 'work-orders.png'), fullPage: false });
  console.log('Screenshot: work-orders.png');

  // 3. Login as tech to create clock-in session
  const techLogin = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'tech@fieldops.dev', password: 'FieldOps2024!' }),
  });
  const techData = await techLogin.json();
  const techToken = techData.data.accessToken;

  // Get a WO
  const woResp = await fetch(`${BASE}/api/work-orders?limit=1`, {
    headers: { Authorization: `Bearer ${techToken}` },
  });
  const woData = await woResp.json();
  const woId = woData.data.work_orders[0].id;

  // Create session
  const sessionResp = await fetch(`${BASE}/api/work-orders/${woId}/clock-in-session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${techToken}`, 'Content-Type': 'application/json' },
  });
  const sessionData = await sessionResp.json();
  console.log('Session created:', sessionData.success);

  // Verify the token
  const verifyResp = await fetch(`${BASE}/api/clock-in/verify?token=${sessionData.session.token}`);
  const verifyData = await verifyResp.json();
  console.log('Verify:', verifyData.success, verifyData.workOrder?.work_order_number);

  // Write API results as proof
  fs.writeFileSync(path.join(SCREENSHOTS, 'api-verification.json'), JSON.stringify({
    session: sessionData,
    verify: verifyData,
    timestamp: new Date().toISOString(),
  }, null, 2));
  console.log('API verification saved');

  await browser.close();
  console.log('Done');
}

main().catch(e => { console.error(e); process.exit(1); });
