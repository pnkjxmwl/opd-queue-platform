/**
 * Fails the build when an element has BOTH a `style` prop and a spread
 * `pressable()` (trap 24 in docs/PROGRESS.md).
 *
 * `pressable()` in lib/ui.tsx returns its own `style`, so whichever appears LAST in
 * JSX wins and the other is silently discarded. The element then renders with none
 * of its intended size, padding or fill.
 *
 * This exists because typecheck and eslint are both perfectly happy with it, and it
 * shipped to a device twice in one day: once making the Join button vanish exactly
 * when it became tappable, once leaving "Book for someone else" as unpadded text
 * hanging below the action bar. There was no automated signal either time.
 *
 * The fix is always the same shape the codebase already uses everywhere else:
 * press feedback on the `Pressable`, visual styling on a child `View`.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.expo', 'dist', 'scripts']);

// One JSX opening tag, non-greedy and refusing to span a nested '<'.
const TAG = /<([A-Z][A-Za-z0-9_.]*)((?:[^<>]|>(?=\s*[^\s<]))*?)\/?>/gs;
const HAS_STYLE = /(^|\s)style\s*=/;

/** @returns {string[]} */
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const problems = [];
for (const file of walk(ROOT)) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(TAG)) {
    const props = match[2];
    if (!props.includes('...pressable(') || !HAS_STYLE.test(props)) continue;
    const line = source.slice(0, match.index).split('\n').length;
    problems.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${line}  <${match[1]}>`);
  }
}

if (problems.length > 0) {
  console.error(
    'A `style` prop next to a spread pressable() - the spread wins and the style is dropped.\n' +
      'Put press feedback on the Pressable and styling on a child View.\n',
  );
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
