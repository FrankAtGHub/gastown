/**
 * Wave 148 Smoke Flow — Mobile Sync Crash Fix + Profile Screen Completion
 *
 * This is a TEMPLATE. Replace the placeholder checks with real assertions
 * for the features added in this wave.
 *
 * Each check should:
 *   1. Navigate to a page or call an API
 *   2. Assert something specific is visible or returns correct data
 *   3. Return { status: 'ok'|'fail', message: '...' }
 *
 * IMPORTANT: Write these checks BEFORE implementation. They SHOULD FAIL
 * until the feature code is written. That's the whole point of TDD.
 *
 * LOGIN: The runner does an API-based login before calling this flow.
 * If you need a DIFFERENT user, use the apiLogin() helper below.
 * Do NOT use page.type() on login form fields — causes double-typing bugs.
 */

'use strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * API-based login — use this if the flow needs a different user than the runner.
 * Sets localStorage token so subsequent page.goto() calls are authenticated.
 *
 * @param {Page} page - Puppeteer page (must already be on the app origin)
 * @param {object} config - { API_BASE_URL, ... }
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {{ ok: boolean, token?: string, message?: string }}
 */
async function apiLogin(page, config, email, password) {
  return page.evaluate(async (c, e, p) => {
    const r = await fetch(`${c.API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e, password: p }),
    });
    const data = await r.json();
    if (data.success && data.data && data.data.accessToken) {
      localStorage.setItem('accessToken', data.data.accessToken);
      if (data.data.refreshToken) localStorage.setItem('refreshToken', data.data.refreshToken);
      return { ok: true, token: data.data.accessToken };
    }
    return { ok: false, message: data.message || `HTTP ${r.status}` };
  }, config, email, password);
}

module.exports = async function wave148Smoke(page, config, ctx) {
  const results = [];

  // --- Example: Check a page loads (already authenticated by runner) ---
  //
  // try {
  //   await page.goto(`${config.APP_BASE_URL}/your-new-route`, {
  //     waitUntil: 'networkidle2',
  //     timeout: 15000,
  //   });
  //   await sleep(1000);
  //
  //   const heading = await page.$eval('[data-testid="page-title"]', el => el.textContent);
  //   if (!heading.includes('Expected Title')) {
  //     return { status: 'fail', message: `Expected "Expected Title", got "${heading}"` };
  //   }
  //   results.push('new-route-loads');
  // } catch (err) {
  //   return { status: 'fail', message: `New route failed: ${err.message}` };
  // }

  // --- Example: Check an API endpoint ---
  //
  // try {
  //   const res = await page.evaluate(async (baseUrl) => {
  //     const token = localStorage.getItem('accessToken');
  //     const r = await fetch(`${baseUrl}/api/your-endpoint`, {
  //       headers: { 'Authorization': `Bearer ${token}` },
  //     });
  //     return { status: r.status, body: await r.json() };
  //   }, config.API_BASE_URL);
  //
  //   if (res.status !== 200) {
  //     return { status: 'fail', message: `API returned ${res.status}` };
  //   }
  //   results.push('api-endpoint-ok');
  // } catch (err) {
  //   return { status: 'fail', message: `API check failed: ${err.message}` };
  // }

  // --- Example: Login as a different user ---
  //
  // try {
  //   const loginRes = await apiLogin(page, config, 'tech@fieldops.dev', 'FieldOps2024!');
  //   if (!loginRes.ok) {
  //     return { status: 'fail', message: `Tech login failed: ${loginRes.message}` };
  //   }
  //   results.push('tech-login-ok');
  // } catch (err) {
  //   return { status: 'fail', message: `Tech login error: ${err.message}` };
  // }


  // --- REQUIRED for external dependency waves: fallback/degraded check ---
  // try {
  //   results.push('fallback-behavior-ok');
  // } catch (err) {
  //   return { status: 'fail', message: `Fallback check failed: ` };
  // }

  // --- REQUIRED for feature-flagged waves: OFF behavior ---
  // try {
  //   results.push('feature-flag-off-ok');
  // } catch (err) {
  //   return { status: 'fail', message: `Feature-flag OFF check failed: ` };
  // }

  // --- REQUIRED for feature-flagged waves: ON behavior ---
  // try {
  //   results.push('feature-flag-on-ok');
  // } catch (err) {
  //   return { status: 'fail', message: `Feature-flag ON check failed: ` };
  // }

  if (results.length === 0) {
    return {
      status: 'fail',
      message: 'No checks implemented yet — QA must add wave-specific assertions before this flow can pass.',
    };
  }

  return {
    status: 'ok',
    message: `${results.length} check(s) passed: ${results.join(', ')}`,
  };
};
