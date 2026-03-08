/**
 * Wave 151 — Crew Self-Clock-In Tests
 *
 * Verifies:
 * 1. API controller has selfClockIn and selfClockOut methods
 * 2. Routes are wired for self-clock-in and self-clock-out
 * 3. Mobile API service has selfClockIn() and selfClockOut() functions
 * 4. WO detail screen imports useAuth and handles self-clock UI
 * 5. Existing crew clock-in endpoints unchanged (no regression)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../../');
const CONTROLLER = path.join(ROOT, 'apps/api/src/controllers/mobile-sync.controller.js');
const ROUTES = path.join(ROOT, 'apps/api/src/routes/mobile-sync.routes.js');
const API_SERVICE = path.join(ROOT, 'apps/mobile/src/services/api.service.ts');
const WO_DETAIL = path.join(ROOT, 'apps/mobile/src/screens/WorkOrderDetailScreen.tsx');

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

console.log('\nWave 151 — Crew Self-Clock-In Tests\n');

const controller = readFile(CONTROLLER);
const routes = readFile(ROUTES);
const apiService = readFile(API_SERVICE);
const woDetail = readFile(WO_DETAIL);

// --- API Controller ---
console.log('API Controller:');

test('controller exports selfClockIn', () => {
  assert(controller.includes('exports.selfClockIn'), 'Missing selfClockIn export');
});

test('controller exports selfClockOut', () => {
  assert(controller.includes('exports.selfClockOut'), 'Missing selfClockOut export');
});

test('selfClockIn validates crew membership', () => {
  assert(controller.includes('work_order_crew') && controller.includes('selfClockIn'),
    'selfClockIn should check work_order_crew');
});

test('selfClockIn uses userId (not technicianId from body)', () => {
  // Self-clock-in should use the authenticated user's ID
  const selfClockInSection = controller.substring(
    controller.indexOf('exports.selfClockIn'),
    controller.indexOf('exports.selfClockOut') || controller.length
  );
  assert(selfClockInSection.includes('userId'), 'selfClockIn should use userId from req.user');
});

test('selfClockIn sets clock_in_method to self', () => {
  assert(controller.includes("'self'"), 'Should set clock_in_method to self');
});

test('selfClockIn checks no open time entry', () => {
  assert(controller.includes('end_time IS NULL'), 'Should check for existing open time entry');
});

// --- Routes ---
console.log('\nRoutes:');

test('route registered for self-clock-in', () => {
  assert(routes.includes('self-clock-in'), 'Missing self-clock-in route');
});

test('route registered for self-clock-out', () => {
  assert(routes.includes('self-clock-out'), 'Missing self-clock-out route');
});

test('routes use POST method', () => {
  assert(routes.includes("post('/sync/work-orders/:id/self-clock-in'") ||
         routes.includes("post('/sync/work-orders/:id/self-clock-in',"),
    'self-clock-in should be POST');
});

// --- Mobile API Service ---
console.log('\nMobile API Service:');

test('api.service exports selfClockIn function', () => {
  assert(apiService.includes('export function selfClockIn') ||
         apiService.includes('export async function selfClockIn'),
    'Missing selfClockIn function');
});

test('api.service exports selfClockOut function', () => {
  assert(apiService.includes('export function selfClockOut') ||
         apiService.includes('export async function selfClockOut'),
    'Missing selfClockOut function');
});

test('selfClockIn calls /self-clock-in endpoint', () => {
  assert(apiService.includes('self-clock-in'), 'Should call self-clock-in endpoint');
});

// --- WO Detail Screen ---
console.log('\nWO Detail Screen:');

test('WO detail imports useAuth', () => {
  assert(woDetail.includes('useAuth'), 'Missing useAuth import');
});

test('WO detail imports selfClockIn', () => {
  assert(woDetail.includes('selfClockIn'), 'Missing selfClockIn import');
});

test('WO detail has clock in/out handler', () => {
  assert(woDetail.includes('handleSelfClockIn') || woDetail.includes('handleClockIn'),
    'Missing self clock-in handler');
});

// --- Regression ---
console.log('\nRegression:');

test('existing crewClockIn export still present', () => {
  assert(controller.includes('exports.crewClockIn'), 'crewClockIn should still exist');
});

test('existing crewClockOut export still present', () => {
  assert(controller.includes('exports.crewClockOut'), 'crewClockOut should still exist');
});

console.log(`\n${passed}/${total} tests passed\n`);

if (failed > 0) process.exit(1);
