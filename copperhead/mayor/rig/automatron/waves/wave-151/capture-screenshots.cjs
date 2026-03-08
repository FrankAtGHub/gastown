const puppeteer = require('puppeteer');
const path = require('path');

async function capture() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const ssDir = path.join(__dirname, 'screenshots');

  const resp = await fetch('https://beta.numeruspro.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@fieldops.dev', password: 'FieldOps2024!' }),
  });
  const body = await resp.json();
  const token = body.data?.accessToken;
  if (!token) { console.log('Login failed'); process.exit(1); }

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('https://beta.numeruspro.com/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(t => localStorage.setItem('accessToken', t), token);
  await page.goto('https://beta.numeruspro.com/dispatch/timesheets', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: path.join(ssDir, 'web-timesheets.png'), fullPage: false });
  console.log('✅ web-timesheets.png');

  const page2 = await browser.newPage();
  await page2.setViewport({ width: 390, height: 844 });
  await page2.goto('https://tech.numeruspro.com', { waitUntil: 'networkidle2', timeout: 30000 });
  await page2.screenshot({ path: path.join(ssDir, 'tech-web.png'), fullPage: false });
  console.log('✅ tech-web.png');

  await browser.close();
  console.log('Done — 2 screenshots captured');
}

capture().catch(e => { console.error(e); process.exit(1); });
