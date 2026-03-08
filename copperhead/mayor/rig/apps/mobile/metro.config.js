const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch monorepo + parent node_modules Node resolution might reach
// (react-native's polyfill setup walks up to workspace root via Node.js resolution)
// monorepoRoot = .../copperhead/mayor/rig → 3 levels up = workspace root
const workspaceRoot = path.resolve(monorepoRoot, '../../..');
config.watchFolders = [
  monorepoRoot,
  path.resolve(workspaceRoot, 'node_modules'),
];

// Let Metro know where to resolve packages
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Force resolution of shared packages to their CJS builds
// This avoids ESM/CJS interop issues with Metro bundler
config.resolver.extraNodeModules = {
  '@field-ops/shared-domain': path.resolve(monorepoRoot, 'packages/shared-domain/dist-cjs'),
  '@field-ops/shared-ui': path.resolve(monorepoRoot, 'packages/shared-ui/dist'),
  '@field-ops/theme': path.resolve(monorepoRoot, 'packages/theme/src'),
};

// Prevent Metro from walking up past monorepo root into parent workspace
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
