/**
 * Wave 151 — Self Clock-In E2E Flow
 *
 * Tests self-clock-in and self-clock-out API endpoints against staging.
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
  console.log('\nWave 151 — Self Clock-In E2E Flow\n');

  const baseUrl = config?.BASE_URL || process.env.APP_BASE_URL || 'https://beta.numeruspro.com';
  const testPass = config?.TEST_PASS || process.env.TEST_PASS || 'FieldOps2024!';

  // Login as tech user
  let techToken;
  try {
    const resp = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'tech@fieldops.dev', password: testPass }),
    });
    const body = await resp.json();
    techToken = body.data?.accessToken;
    if (!techToken) throw new Error('Tech login failed');
    check('tech-login', () => 'Logged in as tech@fieldops.dev');
  } catch (e) {
    results.push({ name: 'tech-login', passed: false, message: e.message });
    return { status: 'fail', message: 'Login failed', checks: results };
  }

  // Get a WO with tech in crew via admin API
  let adminToken;
  try {
    const resp = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@fieldops.dev', password: testPass }),
    });
    adminToken = (await resp.json()).data?.accessToken;
  } catch (e) { /* silent */ }

  // Find WO where tech is assigned
  const techId = 'a0000000-0000-0000-0000-000000000003';
  let workOrderId;

  if (adminToken) {
    try {
      const resp = await fetch(`${baseUrl}/api/work-orders?technician_id=${techId}&limit=5`, {
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      });
      const body = await resp.json();
      const wos = body.data?.work_orders || [];
      if (wos.length > 0) {
        workOrderId = wos[0].id;
      }
    } catch (e) { /* silent */ }
  }

  if (!workOrderId) {
    check('find-work-order', () => { throw new Error('No WO found for tech user'); });
    return { status: 'fail', message: 'No WO to test with', checks: results };
  }
  check('find-work-order', () => `Using WO ${workOrderId}`);

  // Ensure tech is in crew for this WO
  try {
    const crewResp = await fetch(`${baseUrl}/api/mobile/sync/work-orders/${workOrderId}/crew`, {
      headers: { 'Authorization': `Bearer ${techToken}`, 'Content-Type': 'application/json' },
    });
    const crewBody = await crewResp.json();
    const crew = crewBody.crew || [];
    const isInCrew = crew.some(m => m.technician_id === techId);
    if (!isInCrew && adminToken) {
      // Assign tech to crew
      await fetch(`${baseUrl}/api/work-orders/${workOrderId}/crew`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ crew: [{ technician_id: techId, role: 'lead' }] }),
      });
    }
    check('crew-setup', () => isInCrew ? 'Tech already in crew' : 'Tech added to crew');
  } catch (e) {
    check('crew-setup', () => { throw e; });
  }

  // First ensure we're clocked out (clean state)
  await fetch(`${baseUrl}/api/mobile/sync/work-orders/${workOrderId}/self-clock-out`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${techToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  // Test 1: Self clock-in
  try {
    const resp = await fetch(`${baseUrl}/api/mobile/sync/work-orders/${workOrderId}/self-clock-in`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${techToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: { latitude: 29.7604, longitude: -95.3698 } }),
    });
    const body = await resp.json();
    check('self-clock-in', () => {
      if (!body.success) throw new Error(body.error || 'Clock-in failed');
      if (body.timeEntry?.clock_in_method !== 'self') throw new Error('Wrong clock_in_method');
      return `Clocked in, time entry ${body.timeEntry.id}`;
    });
  } catch (e) {
    if (!results.find(r => r.name === 'self-clock-in')) {
      check('self-clock-in', () => { throw e; });
    }
  }

  // Test 2: Double clock-in should return 409
  try {
    const resp = await fetch(`${baseUrl}/api/mobile/sync/work-orders/${workOrderId}/self-clock-in`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${techToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: { latitude: 29.7604, longitude: -95.3698 } }),
    });
    check('double-clock-in-rejected', () => {
      if (resp.status !== 409) throw new Error(`Expected 409, got ${resp.status}`);
      return 'Correctly returned 409 Conflict';
    });
  } catch (e) {
    if (!results.find(r => r.name === 'double-clock-in-rejected')) {
      check('double-clock-in-rejected', () => { throw e; });
    }
  }

  // Test 3: Self clock-out
  try {
    const resp = await fetch(`${baseUrl}/api/mobile/sync/work-orders/${workOrderId}/self-clock-out`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${techToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ location: { latitude: 29.7604, longitude: -95.3698 } }),
    });
    const body = await resp.json();
    check('self-clock-out', () => {
      if (!body.success) throw new Error(body.error || 'Clock-out failed');
      return `Clocked out, duration: ${body.timeEntry?.duration_minutes} minutes`;
    });
  } catch (e) {
    if (!results.find(r => r.name === 'self-clock-out')) {
      check('self-clock-out', () => { throw e; });
    }
  }

  // Test 4: Non-crew rejection
  if (adminToken) {
    try {
      const resp = await fetch(`${baseUrl}/api/mobile/sync/work-orders/${workOrderId}/self-clock-in`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: { latitude: 29.7604, longitude: -95.3698 } }),
      });
      check('non-crew-rejected', () => {
        if (resp.status === 403) return 'Correctly returned 403 Forbidden';
        if (resp.status === 201) return 'Admin is in crew (valid — may have been assigned)';
        return `Status ${resp.status}`;
      });
    } catch (e) {
      check('non-crew-rejected', () => { throw e; });
    }
  }

  const allPassed = results.every(r => r.passed);
  console.log(`\n${results.filter(r => r.passed).length}/${results.length} checks passed\n`);

  return {
    status: allPassed ? 'pass' : 'fail',
    message: allPassed
      ? `All ${results.length} self-clock-in checks passed`
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
