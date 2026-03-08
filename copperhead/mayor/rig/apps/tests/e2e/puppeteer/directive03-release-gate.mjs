#!/usr/bin/env node
/**
 * Directive 03 — Release Gate Verification
 *
 * MANDATORY: This script MUST run at the end of ANY wave of tasks,
 * PR merge, or deployment. No exceptions.
 *
 * This is the "did you actually finish the job?" check. It catches:
 *   - Route files shipped without test files (TDD violation)
 *   - Features added but not wired into navigation (invisible to users)
 *   - API endpoints that 500 due to wrong column names
 *   - Pages that crash on load
 *   - Backend routes registered but returning errors
 *   - New route files not classified in the TDD manifest
 *
 * Usage:
 *   node apps/tests/e2e/puppeteer/directive03-release-gate.mjs
 *
 * Environment Variables:
 *   APP_BASE_URL  - Frontend URL (default: https://beta.numeruspro.com)
 *   API_BASE_URL  - API URL (default: https://beta.numeruspro.com)
 *   TEST_USER     - Login email (default: admin@fieldops.dev)
 *   TEST_PASS     - Login password (default: FieldOps2024!)
 *
 * Exit codes:
 *   0 = All gates passed — safe to ship
 *   1 = Gate failure — DO NOT deploy / roll back
 */

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import path from 'path';
import { readdir, readFile, access } from 'fs/promises';

// ─── Configuration ───────────────────────────────────────────────
const CONFIG = {
  APP_BASE_URL: process.env.APP_BASE_URL || 'https://beta.numeruspro.com',
  API_BASE_URL: process.env.API_BASE_URL || 'https://beta.numeruspro.com',
  TEST_USER: process.env.TEST_USER || 'admin@fieldops.dev',
  TEST_PASS: process.env.TEST_PASS,
  HEADLESS: process.env.HEADLESS !== 'false', // default: true (headless)
  NAV_TIMEOUT: 30_000,
  DEFAULT_TIMEOUT: 15_000,
};

// ─── Result tracker ──────────────────────────────────────────────
const results = { passed: 0, failed: 0, tests: [] };

function pass(gate, name, details = '') {
  results.passed++;
  results.tests.push({ gate, name, status: 'PASS', details });
  console.log(`  \u2705 ${name}${details ? ` (${details})` : ''}`);
}

function fail(gate, name, details = '') {
  results.failed++;
  results.tests.push({ gate, name, status: 'FAIL', details });
  console.log(`  \u274c ${name}${details ? ` \u2014 ${details}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── GATE 1: API Health ─────────────────────────────────────────
// Every registered API route must return 200 (not 500).
async function gateApiHealth(token, realEstimateId) {
  const G = 'Gate 1: API Health';
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`\ud83d\udce1 ${G}`);
  console.log(`${'─'.repeat(60)}`);

  // All known API endpoints grouped by feature area.
  // When you add new routes, ADD THEM HERE.
  const endpoints = [
    // Core
    { path: '/api/customers?limit=1', label: 'Customers' },
    { path: '/api/work-orders?limit=1', label: 'Work Orders' },
    { path: '/api/vendors?limit=1', label: 'Vendors' },
    { path: '/api/purchase-orders?limit=1', label: 'Purchase Orders' },
    { path: '/api/transfers?limit=1', label: 'Transfers' },
    { path: '/api/inventory?limit=1', label: 'Inventory' },
    { path: '/api/line-items?limit=1', label: 'Line Items' },

    // SalesOps
    { path: '/api/crm/estimates?limit=1', label: 'Estimates' },

    // Billing (PR #269)
    { path: '/api/invoices?limit=1', label: 'Invoices' },
    { path: '/api/payments?limit=1', label: 'Payments' },
    { path: '/api/billing-templates', label: 'Billing Templates' },
    { path: '/api/reports/progress-billing-summary', label: 'Progress Billing Report' },
    { path: '/api/reports/retainage-aging', label: 'Retainage Aging Report' },
    { path: '/api/reports/project-profitability', label: 'Profitability Report' },

    // Dispatch
    { path: '/api/dispatch/scheduling', label: 'Scheduling' },

    // Change Orders (requires real estimate ID)
    ...(realEstimateId
      ? [{ path: `/api/estimates/${realEstimateId}/change-orders`, label: 'Change Orders' }]
      : [{ path: '/api/estimates/{id}/change-orders', label: 'Change Orders (no estimate found)', skip: true }]),

    // Projects (Three-Phase)
    { path: '/api/projects?limit=1', label: 'Projects' },
    { path: '/api/projects/staging/queue', label: 'Project Staging Queue' },
  ];

  for (const ep of endpoints) {
    if (ep.skip) {
      console.log(`  \u26a0\ufe0f  ${ep.label} \u2014 skipped (no test data available)`);
      continue;
    }
    try {
      const resp = await fetch(`${CONFIG.API_BASE_URL}${ep.path}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'FieldOps-D03-Gate/1.0' },
      });
      const body = await resp.json().catch(() => ({}));

      if (resp.status === 200 && body.success !== false) {
        pass(G, `${ep.label} (${ep.path})`, `${resp.status}`);
      } else if (resp.status === 200 && body.success === false) {
        fail(G, `${ep.label} (${ep.path})`, `200 but success:false \u2014 ${body.message || body.error || 'unknown'}`);
      } else {
        fail(G, `${ep.label} (${ep.path})`, `HTTP ${resp.status} \u2014 ${body.message || body.error || 'unknown'}`);
      }
    } catch (err) {
      fail(G, `${ep.label} (${ep.path})`, `Network error: ${err.message}`);
    }
  }
}

// ─── GATE 2: Navigation Reachability ────────────────────────────
// Every section in appNav.js navSections MUST appear in the sidebar.
async function gateNavigationReachability(page) {
  const G = 'Gate 2: Navigation Reachability';
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`\ud83e\udded ${G}`);
  console.log(`${'─'.repeat(60)}`);

  await page.goto(`${CONFIG.APP_BASE_URL}/dashboard`, {
    waitUntil: 'networkidle2',
    timeout: CONFIG.NAV_TIMEOUT,
  }).catch(() => {});
  await sleep(3000);

  // These MUST match navSections in appNav.js.
  // When you add a section to navSections, ADD IT HERE.
  // Warehouse is feature-flagged, so it's optional.
  const requiredSections = [
    { label: 'Sales', route: '/sales' },
    { label: 'Procurement', route: '/procurement' },
    { label: 'Dispatch', route: '/dispatch' },
    { label: 'Billing', route: '/billing' },
    { label: 'Reports', route: '/reports' },
  ];

  const optionalSections = [
    { label: 'Warehouse', route: '/warehouse', flag: 'WMS_CONSOLE' },
  ];

  // Get sidebar content
  const sidebarText = await page.evaluate(() => {
    const sidebar = document.querySelector('aside') ||
                    document.querySelector('nav') ||
                    document.querySelector('[class*="sidebar"]') ||
                    document.querySelector('[role="navigation"]');
    return sidebar ? sidebar.innerText.toLowerCase() : '';
  });

  if (!sidebarText) {
    fail(G, 'Sidebar renders', 'No sidebar/nav element found');
    return;
  }
  pass(G, 'Sidebar renders');

  for (const section of requiredSections) {
    if (sidebarText.includes(section.label.toLowerCase())) {
      pass(G, `Sidebar: "${section.label}"`);
    } else {
      fail(G, `Sidebar: "${section.label}"`,
        `INVISIBLE FEATURE \u2014 "${section.label}" is in appNav.js but NOT in the sidebar. ` +
        `Users cannot reach ${section.route}/* pages. ` +
        `Fix: add <SidebarFlyout> for "${section.label}" in Sidebar.jsx`);
    }
  }

  for (const section of optionalSections) {
    if (sidebarText.includes(section.label.toLowerCase())) {
      pass(G, `Sidebar: "${section.label}" (optional)`, `Feature flag: ${section.flag}`);
    } else {
      pass(G, `Sidebar: "${section.label}" (optional)`, `Not shown (feature flag ${section.flag} not enabled)`);
    }
  }
}

// ─── GATE 3: Page Load Smoke Test ───────────────────────────────
// Every user-facing page must load without crashing.
async function gatePageLoadSmoke(page, realEstimateId) {
  const G = 'Gate 3: Page Load Smoke';
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`\ud83d\udcf1 ${G}`);
  console.log(`${'─'.repeat(60)}`);

  // All user-facing routes. When you add pages, ADD THEM HERE.
  const routes = [
    // Dashboard
    { path: '/dashboard', label: 'Dashboard' },

    // Sales
    { path: '/sales/estimates', label: 'Sales: Estimates' },
    { path: '/sales/customers', label: 'Sales: Customers' },
    { path: '/sales/quotes', label: 'Sales: Quotes' },

    // Procurement
    { path: '/procurement/line-items', label: 'Procurement: Line Items' },
    { path: '/procurement/inventory-items', label: 'Procurement: Materials' },
    { path: '/procurement/inventory', label: 'Procurement: Stock Levels' },
    { path: '/procurement/vendors', label: 'Procurement: Vendors' },
    { path: '/procurement/purchase-orders', label: 'Procurement: Purchase Orders' },
    { path: '/procurement/alerts', label: 'Procurement: Alerts' },

    // Dispatch
    { path: '/dispatch/scheduling', label: 'Dispatch: Scheduling' },
    { path: '/dispatch/calendar', label: 'Dispatch: Calendar' },
    { path: '/dispatch/work-orders', label: 'Dispatch: Work Orders' },
    { path: '/dispatch/timesheets', label: 'Dispatch: Timesheets' },
    { path: '/dispatch/clients', label: 'Dispatch: Clients' },
    { path: '/dispatch/technicians', label: 'Dispatch: Technicians' },

    // Billing
    { path: '/billing/invoices', label: 'Billing: Invoices' },
    { path: '/billing/payments', label: 'Billing: Payments' },
    { path: '/billing/templates', label: 'Billing: Templates' },
    { path: '/billing/reports/progress', label: 'Billing: Progress Report' },
    { path: '/billing/reports/profitability', label: 'Billing: Profitability' },

    // Reports
    { path: '/reports/timesheets', label: 'Reports: Timesheets' },
    { path: '/reports/inventory-usage', label: 'Reports: Inventory Usage' },

    // Billing: Change Orders (requires real estimate ID)
    ...(realEstimateId
      ? [{ path: `/billing/estimates/${realEstimateId}/change-orders`, label: 'Billing: Change Orders' }]
      : [{ path: '/billing/estimates/{id}/change-orders', label: 'Billing: Change Orders (no estimate found)', skip: true }]),

    // Settings
    { path: '/settings', label: 'Settings' },
  ];

  for (const route of routes) {
    if (route.skip) {
      console.log(`  \u26a0\ufe0f  ${route.label} \u2014 skipped (no test data available)`);
      continue;
    }
    try {
      await page.goto(`${CONFIG.APP_BASE_URL}${route.path}`, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.NAV_TIMEOUT,
      });
      await sleep(1500);

      const health = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return {
          hasCrash: text.includes('Something went wrong') || text.includes('Application error'),
          has500: text.includes('Internal Server Error'),
          hasError: text.includes('Failed to load') || text.includes('Error loading'),
          isBlank: text.trim().length < 20,
        };
      });

      if (health.hasCrash) {
        fail(G, route.label, 'Page crash (React error boundary)');
      } else if (health.has500) {
        fail(G, route.label, '500 Internal Server Error');
      } else if (health.isBlank) {
        fail(G, route.label, 'Page is blank (< 20 chars)');
      } else {
        pass(G, route.label);
      }
    } catch (err) {
      fail(G, route.label, `Navigation error: ${err.message}`);
    }
  }
}

// ─── GATE 4: Data Existence ─────────────────────────────────────
// Minimum data must exist for the demo to work.
async function gateDataExistence(token) {
  const G = 'Gate 4: Data Existence';
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`\ud83d\udcca ${G}`);
  console.log(`${'─'.repeat(60)}`);

  const checks = [
    { path: '/api/customers?limit=100', key: 'data.customers', label: 'Customers', min: 1 },
    { path: '/api/crm/estimates?limit=100', key: 'data.estimates', label: 'Estimates', min: 3 },
    { path: '/api/work-orders?limit=100', key: 'data.work_orders', label: 'Work Orders', min: 6 },
    { path: '/api/vendors?limit=100', key: 'vendors', label: 'Vendors', min: 3 },
    { path: '/api/inventory?limit=100', key: 'data', label: 'Inventory Items', min: 10 },
  ];

  for (const check of checks) {
    try {
      const resp = await fetch(`${CONFIG.API_BASE_URL}${check.path}`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'FieldOps-D03-Gate/1.0' },
      });
      const body = await resp.json().catch(() => ({}));

      // Navigate the response shape to find the array
      let data = body;
      for (const k of check.key.split('.')) {
        data = data?.[k];
      }
      const count = Array.isArray(data) ? data.length : 0;

      if (count >= check.min) {
        pass(G, check.label, `${count} >= ${check.min}`);
      } else {
        fail(G, check.label, `${count} < ${check.min} minimum`);
      }
    } catch (err) {
      fail(G, check.label, `Error: ${err.message}`);
    }
  }
}

// ─── GATE 5: TDD Compliance ─────────────────────────────────
// Every new feature MUST have tests. This gate scans the codebase
// and fails if required route files lack corresponding test files.
//
// HOW TO USE:
//   When you add a new route file, ADD IT to TDD_REQUIRED below.
//   Then write the tests. If you skip this, Gate 5 will fail.
//   Route files NOT in TDD_REQUIRED or GRANDFATHERED trigger a WARNING.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

// Routes that MUST have test coverage to pass the release gate.
// Format: { routeFile: { tests: [paths relative to apps/api/src/], feature: 'label' } }
// When adding a new feature, ADD YOUR ROUTES HERE.
const TDD_REQUIRED = {
  // Crew Clock-In (PR #268)
  'mobile-sync.routes.js': {
    tests: [
      'controllers/__tests__/mobile-sync.crew.test.js',
      'controllers/__tests__/mobile-sync.bootstrap.test.js',
    ],
    feature: 'Crew Clock-In',
  },
  'workOrder.routes.js': {
    tests: ['routes/__tests__/workOrder.crew.test.js'],
    feature: 'Work Order Crew',
  },

  // Dispatch (pre-existing, has tests)
  'dispatch.routes.js': {
    tests: ['routes/__tests__/dispatch.routes.test.js'],
    feature: 'Dispatch',
  },

  // Inventory (pre-existing, has tests)
  'inventoryDomain.routes.js': {
    tests: ['routes/__tests__/inventoryDomain.routes.test.js'],
    feature: 'Inventory Domain',
  },

  // Progressive Invoicing (PR #269) — MUST HAVE TESTS
  'billing.routes.js': {
    tests: ['routes/__tests__/billing.routes.test.js'],
    feature: 'Progressive Invoicing',
  },
  'invoice.routes.js': {
    tests: ['routes/__tests__/invoice.routes.test.js'],
    feature: 'Progressive Invoicing',
  },
  'payment.routes.js': {
    tests: ['routes/__tests__/payment.routes.test.js'],
    feature: 'Progressive Invoicing',
  },

  // Three-Phase Projects (migration 084)
  'project.routes.js': {
    tests: ['tests/e2e/phaseDepCascade.e2e.test.js'],
    feature: 'Three-Phase Projects',
  },

  // PCO→CO Bridge (Wave 38)
  'changeOrderRequest.routes.js': {
    tests: ['routes/__tests__/changeOrderRequest.routes.test.js'],
    feature: 'PCO-CO Bridge',
  },

  // Custom Roles (Wave 58)
  'roles.routes.js': {
    tests: ['routes/__tests__/roles.routes.test.js'],
    feature: 'Custom Roles',
  },

};

// Pre-TDD-mandate routes (existed before 2026-02-20). Not required to have
// tests yet, but tracked. These should eventually get tests too.
const GRANDFATHERED = new Set([
  'action.routes.js', 'addOn.routes.js', 'ai.routes.js', 'analytics.routes.js',
  'approvedQueue.routes.js', 'auth.routes.js', 'barcodeLookup.routes.js',
  'bugReport.routes.js', 'changeOrderApproval.routes.js',
  'crm.routes.js', 'customer.routes.js', 'cycleCount.routes.js', 'dashboard.routes.js',
  'docsExchange.routes.js', 'documentSequences.routes.js', 'estimateArea.routes.js', 'estimatePdf.routes.js',
  'estimateProcurementReview.routes.js', 'estimateReview.routes.js', 'file.routes.js',
  'health.routes.js', 'import.routes.js', 'integrations.routes.js', 'inventory.routes.js',
  'inventoryItemRequest.routes.js', 'jobTemplate.routes.js', 'kits.routes.js',
  'laborCostEmployees.routes.js', 'lineage.routes.js', 'lineItem.routes.js',
  'loadouts.routes.js', 'location.routes.js', 'maintenance.routes.js',
  'materialPlan.routes.js', 'materialRequest.routes.js', 'message.routes.js',
  'notificationPreferences.routes.js', 'notification.routes.js', 'notifications.routes.js',
  'onboarding.routes.js', 'photos.routes.js', 'pricingRequest.routes.js',
  'pricing.routes.js', 'printTemplates.routes.js', 'procurementAnalytics.routes.js',
  'procurementOrchestration.routes.js', 'procurementWorkflow.routes.js',
  'public.routes.js', 'purchaseOrderPdf.routes.js',
  'purchaseOrder.routes.js', 'quote.routes.js', 'reports.routes.js',
  'restockSuggestions.routes.js', 'rma.routes.js', 'safety.routes.js',
  'serializedItems.routes.js', 'siteEquipment.routes.js', 'sites.routes.js',
  'sso.routes.js', 'task.routes.js', 'taxonomy.routes.js', 'technician.routes.js',
  'templateReuse.routes.js', 'tenantSettings.routes.js', 'timeEntry.routes.js',
  'transaction.routes.js', 'transferPdf.routes.js', 'transfer.routes.js',
  'user.routes.js', 'vehicle.routes.js', 'vendor.routes.js', 'warranty.routes.js',
  'wmsReporting.routes.js', 'workOrderPdf.routes.js', 'workTemplate.routes.js',
  'clock-in.routes.js', // Wave 152 — QR Clock-In (tests in automatron/waves/wave-152/)
]);

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fileHasTests(filePath) {
  try {
    const content = await readFile(filePath, 'utf-8');
    // Must have at least one describe/it/test block — not just an empty file
    return /\b(describe|it|test)\s*\(/.test(content);
  } catch {
    return false;
  }
}

async function gateTddCompliance() {
  const G = 'Gate 5: TDD Compliance';
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`\ud83e\uddea ${G}`);
  console.log(`${'─'.repeat(60)}`);

  const routesDir = path.join(PROJECT_ROOT, 'apps', 'api', 'src', 'routes');
  const apiSrcDir = path.join(PROJECT_ROOT, 'apps', 'api', 'src');

  // Check if we can access the filesystem (won't work in CI without source)
  if (!(await fileExists(routesDir))) {
    console.log('  \u26a0\ufe0f  Skipping TDD gate — route directory not found (remote-only run?)');
    console.log(`     Expected: ${routesDir}`);
    return;
  }

  // 1. Check TDD_REQUIRED routes have tests
  let requiredPassed = 0;
  let requiredFailed = 0;

  for (const [routeFile, config] of Object.entries(TDD_REQUIRED)) {
    const routePath = path.join(routesDir, routeFile);
    const routeExists = await fileExists(routePath);

    if (!routeExists) {
      // Route file doesn't exist — not an error, it might have been renamed
      pass(G, `${config.feature}: ${routeFile}`, 'route file not present (OK)');
      requiredPassed++;
      continue;
    }

    let allTestsExist = true;
    const missingTests = [];

    for (const testRelPath of config.tests) {
      const testPath = path.join(apiSrcDir, testRelPath);
      const exists = await fileExists(testPath);
      const hasContent = exists ? await fileHasTests(testPath) : false;

      if (!exists) {
        allTestsExist = false;
        missingTests.push(`${testRelPath} (MISSING)`);
      } else if (!hasContent) {
        allTestsExist = false;
        missingTests.push(`${testRelPath} (EMPTY — no describe/it/test blocks)`);
      }
    }

    if (allTestsExist) {
      pass(G, `${config.feature}: ${routeFile}`, `${config.tests.length} test file(s)`);
      requiredPassed++;
    } else {
      fail(G, `${config.feature}: ${routeFile}`,
        `UNTESTED ROUTE \u2014 missing: ${missingTests.join(', ')}. ` +
        'Write tests BEFORE shipping. TDD is mandatory.');
      requiredFailed++;
    }
  }

  // 2. Scan for NEW route files not in any list
  let allRouteFiles;
  try {
    const files = await readdir(routesDir);
    allRouteFiles = files.filter(f => f.endsWith('.routes.js'));
  } catch {
    allRouteFiles = [];
  }

  const unknownRoutes = allRouteFiles.filter(f =>
    !TDD_REQUIRED[f] && !GRANDFATHERED.has(f)
  );

  if (unknownRoutes.length > 0) {
    for (const unknown of unknownRoutes) {
      fail(G, `Unclassified route: ${unknown}`,
        'NEW route file not in TDD_REQUIRED or GRANDFATHERED. ' +
        'Add it to TDD_REQUIRED in directive03-release-gate.mjs and write tests, ' +
        'or add to GRANDFATHERED if pre-existing.');
    }
  }

  // 3. Coverage summary (informational)
  const totalRoutes = allRouteFiles.length;
  const testedRoutes = Object.keys(TDD_REQUIRED).filter(r =>
    allRouteFiles.includes(r)
  ).length;
  const grandfatheredCount = allRouteFiles.filter(r => GRANDFATHERED.has(r)).length;

  console.log(`\n  TDD Coverage Summary:`);
  console.log(`    Total route files: ${totalRoutes}`);
  console.log(`    Required + tested: ${requiredPassed} of ${requiredPassed + requiredFailed}`);
  console.log(`    Grandfathered (pre-TDD mandate): ${grandfatheredCount}`);
  console.log(`    Unclassified: ${unknownRoutes.length}`);
  console.log(`    Coverage: ${totalRoutes > 0 ? ((testedRoutes / totalRoutes) * 100).toFixed(1) : 0}%`);
}

// ─── LOGIN ──────────────────────────────────────────────────────
async function apiLogin() {
  const resp = await fetch(`${CONFIG.API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'FieldOps-D03-Gate/1.0' },
    body: JSON.stringify({ email: CONFIG.TEST_USER, password: CONFIG.TEST_PASS }),
  });
  const body = await resp.json();
  if (!body.data?.accessToken) {
    throw new Error(`Login failed: ${body.message || 'unknown error'}`);
  }
  return body.data.accessToken;
}

async function browserLogin(page) {
  try {
    await page.goto(`${CONFIG.APP_BASE_URL}/login`, {
      waitUntil: 'domcontentloaded',
      timeout: CONFIG.NAV_TIMEOUT,
    });
  } catch (navErr) {
    console.log(`  [WARN] Navigation to /login issue: ${navErr.message}`);
  }
  // Wait for SPA to hydrate
  await sleep(3000);

  try {
    await page.waitForSelector('input[type="email"], input[name="email"], [data-testid="login-email"]', { timeout: 15_000 });
    await page.type('input[type="email"], input[name="email"], [data-testid="login-email"]', CONFIG.TEST_USER);
    await page.type('input[type="password"], input[name="password"]', CONFIG.TEST_PASS);
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
    await sleep(3000);
  } catch (err) {
    // Capture debug info
    const url = page.url();
    const title = await page.title().catch(() => 'unknown');
    throw new Error(`Browser login failed: ${err.message} (url=${url}, title=${title})`);
  }
}

// ─── MAIN ───────────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(60));
  console.log('DIRECTIVE 03 \u2014 Release Gate Verification');
  console.log('='.repeat(60));
  console.log('\nThis MUST pass before any work is considered done.');
  console.log('If it fails, the work is not complete. Period.\n');
  console.log('Config:', {
    APP_BASE_URL: CONFIG.APP_BASE_URL,
    TEST_USER: CONFIG.TEST_USER,
    HEADLESS: CONFIG.HEADLESS,
  });
  console.log('='.repeat(60));

  const startTime = Date.now();
  let browser;

  try {
    // API login
    console.log('\n[AUTH] Logging in via API...');
    const token = await apiLogin();
    console.log('[AUTH] API login successful');

    // Look up a real estimate ID for endpoints that need one
    let realEstimateId = null;
    try {
      const estResp = await fetch(`${CONFIG.API_BASE_URL}/api/crm/estimates?limit=1`, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'FieldOps-D03-Gate/1.0' },
      });
      const estBody = await estResp.json().catch(() => ({}));
      realEstimateId = estBody?.data?.rows?.[0]?.id || estBody?.data?.[0]?.id || null;
      if (realEstimateId) {
        console.log(`[SETUP] Found estimate ID: ${realEstimateId}`);
      } else {
        console.log('[SETUP] \u26a0\ufe0f  No estimates found — change-orders tests will be skipped');
      }
    } catch (err) {
      console.log(`[SETUP] \u26a0\ufe0f  Could not fetch estimate ID: ${err.message}`);
    }

    // Gate 5: TDD Compliance (local filesystem scan — no network needed)
    await gateTddCompliance();

    // Gate 1: API Health (no browser needed)
    await gateApiHealth(token, realEstimateId);

    // Gate 4: Data Existence (no browser needed)
    await gateDataExistence(token);

    // Browser-based gates
    browser = await puppeteer.launch({
      headless: CONFIG.HEADLESS ? 'new' : false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--window-size=1440,900',
      ],
      defaultViewport: { width: 1440, height: 900 },
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(CONFIG.NAV_TIMEOUT);
    page.setDefaultTimeout(CONFIG.DEFAULT_TIMEOUT);

    // Browser login
    console.log('\n[AUTH] Logging in via browser...');
    await browserLogin(page);
    console.log('[AUTH] Browser login successful');

    // Gate 2: Navigation Reachability
    await gateNavigationReachability(page);

    // Gate 3: Page Load Smoke Test
    await gatePageLoadSmoke(page, realEstimateId);

  } catch (err) {
    console.error(`\n[FATAL] ${err.message}`);
    console.error(err.stack);
    fail('FATAL', 'Test execution', err.message);
  } finally {
    if (browser) await browser.close();
  }

  // ─── Summary ───────────────────────────────────────────────────
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${'='.repeat(60)}`);
  console.log('DIRECTIVE 03 RELEASE GATE SUMMARY');
  console.log('='.repeat(60));
  console.log(`\n  Total gates: ${results.passed + results.failed}`);
  console.log(`  \u2705 Passed: ${results.passed}`);
  console.log(`  \u274c Failed: ${results.failed}`);
  console.log(`  Duration: ${duration}s`);

  if (results.failed > 0) {
    console.log('\n  \u274c FAILED GATES:');
    results.tests
      .filter((t) => t.status === 'FAIL')
      .forEach((t) => {
        console.log(`    [${t.gate}] ${t.name}: ${t.details}`);
      });
    console.log(`\n${'='.repeat(60)}`);
    console.log('\n\u274c RELEASE GATE: BLOCKED \u2014 Fix failures before shipping.\n');
    process.exit(1);
  } else {
    console.log(`\n${'='.repeat(60)}`);
    console.log('\n\u2705 RELEASE GATE: PASSED \u2014 Safe to ship.\n');
    process.exit(0);
  }
}

main();
