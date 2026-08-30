/**
 * Regenerate `.expo/types/router.d.ts`, the declaration that makes expo-router's
 * typed routes actually type-checked.
 *
 * Why this exists: `.expo/` is gitignored, and only `expo start` writes that file.
 * So on a fresh checkout - which is every CI run - `Href` degrades to `string` and
 * `router.push('/dpeartment/[id]')` typechecks perfectly. The mobile typecheck was
 * silently not checking the one thing typed routes are for.
 *
 * Wired into the `typecheck` script so it runs everywhere, not just where someone
 * remembered to start the dev server.
 *
 * ponytail: reaches into expo-router's build output because there is no public CLI
 * for this. Pinned by the SDK version in package.json; if an upgrade moves these
 * paths the script fails loudly, which is the correct outcome.
 */
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '../app');
const outDir = path.resolve(__dirname, '../.expo/types');

const requireContext = require('expo-router/build/testing-library/require-context-ponyfill').default;
const { EXPO_ROUTER_CTX_IGNORE } = require('expo-router/_ctx-shared');
const { getTypedRoutesDeclarationFile } = require('expo-router/build/typed-routes/generate');

const declaration = getTypedRoutesDeclarationFile(
  requireContext(appRoot, true, EXPO_ROUTER_CTX_IGNORE),
  {},
);

if (!declaration) throw new Error('expo-router produced no route declaration');

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'router.d.ts'), declaration);
