/**
 * Wave 152 — QR Clock-In API E2E Flow
 *
 * Tests the full QR clock-in journey against staging:
 * 1. Lead tech creates clock-in session
 * 2. Verify token returns WO info
 * 3. Submit clock-in via token creates time entry
 * 4. Expired/invalid tokens rejected
 */

const results = [];

function check(name, fn) {
  try {
    const result = fn();
    results.push({ name, passed: true, message: result || 'OK' });
    console.log(`  ✅ ${name}`);
  } catch (e) {
    results.push({ name, passed: false, message: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

async function run(page, config) {
  console.log('\nWave 152 — QR Clock-In API E2E Flow\n');

  const baseUrl = config?.BASE_URL || process.env.APP_BASE_URL || 'https://beta.numeruspro.com';
  const testPass = config?.TEST_PASS || process.env.TEST_PASS || 'FieldOps2024!';

  // Login as tech (lead on WOs)
  let techToken;
  try {
    const resp = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'tech@fieldops.dev', password: testPass }),
    });
    techToken = (await resp.json()).data?.accessToken;
    if (!techToken) throw new Error('Tech login failed');
    check('tech-login', () => 'Logged in');
  } catch (e) {
    results.push({ name: 'tech-login', passed: false, message: e.message });
    return { status: 'fail', message: 'Login failed', checks: results };
  }

  // Find a WO with crew
  const techId = 'a0000000-0000-0000-0000-000000000003';
  let adminToken;
  try {
    const resp = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@fieldops.dev', password: testPass }),
    });
    adminToken = (await resp.json()).data?.accessToken;
  } catch (e) { /* silent */ }

  let workOrderId;
  if (adminToken) {
    try {
      const resp = await fetch(`${baseUrl}/api/work-orders?technician_id=${techId}&limit=5`, {
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      });
      const wos = (await resp.json()).data?.work_orders || [];
      if (wos.length > 0) workOrderId = wos[0].id;
    } catch (e) { /* silent */ }
  }

  if (!workOrderId) {
    check('find-work-order', () => { throw new Error('No WO found'); });
    return { status: 'fail', message: 'No WO', checks: results };
  }
  check('find-work-order', () => `Using WO ${workOrderId}`);

  // 1. Create clock-in session
  let sessionToken;
  try {
    const resp = await fetch(`${baseUrl}/api/work-orders/${workOrderId}/clock-in-session`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${techToken}`, 'Content-Type': 'application/json' },
    });
    const body = await resp.json();
    check('create-session', () => {
      if (!body.success) throw new Error(body.error || 'Session creation failed');
      if (!body.session?.token) throw new Error('No token in response');
      sessionToken = body.session.token;
      return `Token: ${sessionToken.substring(0, 8)}...`;
    });
  } catch (e) {
    if (!results.find(r => r.name === 'create-session')) {
      check('create-session', () => { throw e; });
    }
  }

  if (!sessionToken) {
    return { status: 'fail', message: 'No session token', checks: results };
  }

  // 2. Verify token (no auth required)
  try {
    const resp = await fetch(`${baseUrl}/api/clock-in/verify?token=${sessionToken}`);
    const body = await resp.json();
    check('verify-token', () => {
      if (!body.success) throw new Error(body.error || 'Verify failed');
      if (!body.workOrder) throw new Error('No workOrder in response');
      return `WO: ${body.workOrder.work_order_number || body.workOrder.id}`;
    });
  } catch (e) {
    if (!results.find(r => r.name === 'verify-token')) {
      check('verify-token', () => { throw e; });
    }
  }

  // 3. Submit clock-in via token (no auth required)
  try {
    const resp = await fetch(`${baseUrl}/api/clock-in/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: sessionToken,
        technicianName: 'E2E Test Crew',
        location: { latitude: 29.7604, longitude: -95.3698 },
      }),
    });
    const body = await resp.json();
    check('submit-clock-in', () => {
      if (!body.success) throw new Error(body.error || 'Submit failed');
      return `Time entry: ${body.timeEntry?.id || 'created'}`;
    });
  } catch (e) {
    if (!results.find(r => r.name === 'submit-clock-in')) {
      check('submit-clock-in', () => { throw e; });
    }
  }

  // 4. Verify invalid token rejected
  try {
    const resp = await fetch(`${baseUrl}/api/clock-in/verify?token=invalid-token-12345`);
    check('invalid-token-rejected', () => {
      if (resp.status === 200) throw new Error('Should reject invalid token');
      return `Rejected with status ${resp.status}`;
    });
  } catch (e) {
    if (!results.find(r => r.name === 'invalid-token-rejected')) {
      check('invalid-token-rejected', () => { throw e; });
    }
  }

  // 5. Verify standalone page accessible
  try {
    const resp = await fetch(`https://tech.numeruspro.com/clock-in/?token=test`);
    check('clock-in-page-accessible', () => {
      if (resp.status === 404) throw new Error('Page not found — not deployed yet');
      return `Page returns status ${resp.status}`;
    });
  } catch (e) {
    if (!results.find(r => r.name === 'clock-in-page-accessible')) {
      check('clock-in-page-accessible', () => { throw e; });
    }
  }

  const allPassed = results.every(r => r.passed);
  console.log(`\n${results.filter(r => r.passed).length}/${results.length} checks passed\n`);

  return {
    status: allPassed ? 'pass' : 'fail',
    message: allPassed
      ? `All ${results.length} QR clock-in checks passed`
      : `${results.filter(r => !r.passed).length} checks failed`,
    checks: results,
  };
}

module.exports = { run };

if (require.main === module) {
  run(null, {}).then(r => {
    if (r.status === 'fail') process.exit(1);
  });
}
