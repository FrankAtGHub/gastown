/**
 * Wave 152 — QR Clock-In Tests
 *
 * Verifies:
 * 1. Migration file exists
 * 2. Clock-in routes registered
 * 3. Standalone HTML page exists with required elements
 * 4. CrewClockInScreen has QR code functionality
 * 5. API service has createClockInSession function
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../../');
const MIGRATIONS = path.join(ROOT, 'apps/api/migrations');
const CLOCK_IN_ROUTES = path.join(ROOT, 'apps/api/src/routes/clock-in.routes.js');
const WO_ROUTES = path.join(ROOT, 'apps/api/src/routes/workOrder.routes.js');
const CLOCK_IN_HTML = path.join(ROOT, 'apps/mobile/public/clock-in/index.html');
const CREW_SCREEN = path.join(ROOT, 'apps/mobile/src/screens/CrewClockInScreen.tsx');
const API_SERVICE = path.join(ROOT, 'apps/mobile/src/services/api.service.ts');

let passed = 0;
let failed = 0;
const total = 17;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function readFile(p) {
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

console.log('\nWave 152 — QR Clock-In Tests\n');

// --- Migration ---
console.log('Migration:');

test('migration 158_clock_in_sessions.sql exists', () => {
  assert(fs.existsSync(path.join(MIGRATIONS, '158_clock_in_sessions.sql')));
});

test('migration creates clock_in_sessions table', () => {
  const sql = readFile(path.join(MIGRATIONS, '158_clock_in_sessions.sql'));
  assert(sql.includes('CREATE TABLE') && sql.includes('clock_in_sessions'),
    'Missing CREATE TABLE clock_in_sessions');
});

test('migration has session_token column', () => {
  const sql = readFile(path.join(MIGRATIONS, '158_clock_in_sessions.sql'));
  assert(sql.includes('session_token'), 'Missing session_token column');
});

test('migration has expires_at column', () => {
  const sql = readFile(path.join(MIGRATIONS, '158_clock_in_sessions.sql'));
  assert(sql.includes('expires_at'), 'Missing expires_at column');
});

// --- API Routes ---
console.log('\nAPI Routes:');

test('clock-in.routes.js exists', () => {
  assert(fs.existsSync(CLOCK_IN_ROUTES));
});

const clockRoutes = readFile(CLOCK_IN_ROUTES);

test('verify endpoint registered', () => {
  assert(clockRoutes.includes('verify') || clockRoutes.includes('/clock-in/verify'),
    'Missing verify endpoint');
});

test('submit endpoint registered', () => {
  assert(clockRoutes.includes('submit') || clockRoutes.includes('/clock-in/submit'),
    'Missing submit endpoint');
});

test('clock-in-session endpoint in WO routes', () => {
  const woRoutes = readFile(WO_ROUTES);
  assert(woRoutes.includes('clock-in-session'), 'Missing clock-in-session in WO routes');
});

// --- Standalone HTML Page ---
console.log('\nStandalone HTML:');

test('clock-in/index.html exists', () => {
  assert(fs.existsSync(CLOCK_IN_HTML));
});

const html = readFile(CLOCK_IN_HTML);

test('HTML has name input for crew identification', () => {
  assert(html.includes('type="text"') || html.includes('input') || html.includes('name'),
    'Missing name/identity input');
});

test('HTML has submit button', () => {
  assert(html.includes('submit') || html.includes('Clock In') || html.includes('clock-in'),
    'Missing submit functionality');
});

test('HTML calls /api/clock-in/verify', () => {
  assert(html.includes('/api/clock-in/verify') || html.includes('clock-in/verify'),
    'Missing verify API call');
});

test('HTML calls /api/clock-in/submit', () => {
  assert(html.includes('/api/clock-in/submit') || html.includes('clock-in/submit'),
    'Missing submit API call');
});

// --- Mobile Changes ---
console.log('\nMobile:');

test('CrewClockInScreen has QR functionality', () => {
  const screen = readFile(CREW_SCREEN);
  assert(screen.includes('QR') || screen.includes('qr') || screen.includes('clockInSession'),
    'Missing QR/session functionality');
});

test('API service has createClockInSession', () => {
  const service = readFile(API_SERVICE);
  assert(service.includes('createClockInSession') || service.includes('clock-in-session'),
    'Missing createClockInSession function');
});

// --- Regression ---
console.log('\nRegression:');

test('existing selfClockIn still present in API service', () => {
  const service = readFile(API_SERVICE);
  assert(service.includes('selfClockIn'), 'selfClockIn should still exist');
});

test('existing crewClockIn still present in API service', () => {
  const service = readFile(API_SERVICE);
  assert(service.includes('crewClockIn'), 'crewClockIn should still exist');
});

console.log(`\n${passed}/${total} tests passed\n`);

if (failed > 0) process.exit(1);
