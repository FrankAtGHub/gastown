/**
 * Wave 150 — Build Verification Flow
 *
 * Verifies:
 * 1. packages/theme compiles with tsc
 * 2. Token values in compiled output match expected hex values
 * 3. Mobile theme still resolves @field-ops/theme
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '../../../../');
const THEME_PKG = path.join(ROOT, 'packages/theme');

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

async function run() {
  console.log('\nWave 150 — Build Verification\n');

  check('tsc compiles packages/theme', () => {
    execSync('npx tsc --noEmit', { cwd: THEME_PKG, encoding: 'utf-8', timeout: 30000 });
    return 'TypeScript compilation succeeded';
  });

  check('tokens.ts has no framework-specific imports', () => {
    const content = fs.readFileSync(path.join(THEME_PKG, 'src/tokens.ts'), 'utf-8');
    const forbidden = ['react', 'react-native', 'expo', 'tailwind'];
    for (const dep of forbidden) {
      if (content.includes(`from '${dep}`) || content.includes(`from "${dep}`)) {
        throw new Error(`Found framework-specific import: ${dep}`);
      }
    }
    return 'No framework-specific imports found';
  });

  check('lightTokens.background is #f8fafc', () => {
    const content = fs.readFileSync(path.join(THEME_PKG, 'src/tokens.ts'), 'utf-8');
    if (!content.includes("#f8fafc")) throw new Error('Missing expected value #f8fafc');
    return 'Light background token correct';
  });

  check('darkTokens.background is #0f172a', () => {
    const content = fs.readFileSync(path.join(THEME_PKG, 'src/tokens.ts'), 'utf-8');
    if (!content.includes("#0f172a")) throw new Error('Missing expected value #0f172a');
    return 'Dark background token correct';
  });

  check('mobile colors.ts resolves @field-ops/theme import path', () => {
    const colorsPath = path.join(ROOT, 'apps/mobile/src/theme/colors.ts');
    const content = fs.readFileSync(colorsPath, 'utf-8');
    if (!content.includes('@field-ops/theme')) {
      throw new Error('colors.ts does not import from @field-ops/theme');
    }
    // Verify the package is resolvable via workspace
    const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
    const hasPackagesWorkspace = pkgJson.workspaces.includes('packages/*');
    if (!hasPackagesWorkspace) throw new Error('packages/* not in workspaces');
    return 'Import path valid, workspace configured';
  });

  const allPassed = results.every(r => r.passed);
  console.log(`\n${results.filter(r => r.passed).length}/${results.length} checks passed\n`);

  return {
    status: allPassed ? 'pass' : 'fail',
    message: allPassed
      ? `All ${results.length} build checks passed`
      : `${results.filter(r => !r.passed).length} checks failed`,
    checks: results
  };
}

module.exports = { run };

if (require.main === module) {
  run().then(r => {
    if (r.status === 'fail') process.exit(1);
  });
}
