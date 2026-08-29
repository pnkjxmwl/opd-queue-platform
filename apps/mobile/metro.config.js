// Monorepo Metro config.
// Metro does not follow workspace packages by default: it must be told to WATCH
// the repo root (so edits to packages/contracts trigger a reload) and where to
// RESOLVE modules from. Without this, importing @opd/contracts fails at runtime.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// NOT disableHierarchicalLookup: that is advice for HOISTED monorepos. Under pnpm's
// isolated layout, transitive deps (e.g. @expo/metro-runtime, reached via expo-router)
// live only in their parent's nested node_modules, and Metro must be allowed to walk
// up into them or the bundle fails to resolve.

module.exports = config;
