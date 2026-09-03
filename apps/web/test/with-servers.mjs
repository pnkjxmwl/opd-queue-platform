import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// fileURLToPath, never URL.pathname: on Windows the latter yields "/C:/..." and
// leaves the space in "New folder" percent-encoded, so the path does not exist and
// the failure arrives as MODULE_NOT_FOUND rather than as anything about a path.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

/**
 * Runs the console walkthrough against servers it starts itself.
 *
 * **Why this exists.** The 63 checks in `console-walkthrough.mjs` have been passing
 * for two phases and had never once run in CI, because they needed somebody to have
 * `pnpm dev` going in two terminals first. A test that only runs when a human
 * remembers to run it is a test that stops running - and `apps/web`'s `test` script
 * was literally an `echo` saying so.
 *
 * The blocker was never the test framework. It was `fixture.mjs` shelling out to
 * `docker exec opd-postgres`, which only exists on a developer's laptop; CI runs
 * Postgres as a service on localhost. That is fixed, so all that remained was
 * starting the two servers.
 *
 * Deliberately not Playwright. A browser would add a 300MB download to every CI run
 * to re-prove 63 checks that already pass, and this harness is not a poor substitute
 * for one - it drives Next's server actions over plain HTTP on purpose, which is
 * faster and tests the server contract rather than the browser's. What a browser
 * WOULD add is client-side JavaScript coverage, and that is worth its own decision
 * rather than being smuggled in here.
 */

const API_PORT = 3000;
const WEB_PORT = 3001;

/** Already-running servers are used as they are - the common case on a laptop. */
async function isUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitFor(url, label, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isUp(url)) return;
    await sleep(1000);
  }
  throw new Error(`${label} never came up at ${url}`);
}

function start(name, args) {
  const child = spawn('pnpm', args, {
    cwd: REPO_ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  // Kept, not printed: a server's startup chatter would bury the walkthrough's own
  // output, but it is exactly what you want if it fails to start.
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));
  return { name, child, log };
}

const started = [];

function stopAll() {
  for (const { child } of started) {
    if (child.exitCode === null) child.kill();
  }
}

process.on('exit', stopAll);
process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});

const apiUp = await isUp(`http://localhost:${API_PORT}/health`);
const webUp = await isUp(`http://localhost:${WEB_PORT}/login`);

if (!apiUp) started.push(start('api', ['--filter', '@opd/api', 'start']));
if (!webUp) started.push(start('web', ['--filter', '@opd/web', 'dev']));

if (started.length > 0) {
  console.log(`starting ${started.map((s) => s.name).join(' and ')}…`);
}

try {
  if (!apiUp) await waitFor(`http://localhost:${API_PORT}/health`, 'the API');
  if (!webUp) await waitFor(`http://localhost:${WEB_PORT}/login`, 'the console');
} catch (error) {
  for (const { name, log } of started) {
    console.error(`\n--- ${name} output ---\n${log.join('').slice(-4000)}`);
  }
  stopAll();
  throw error;
}

const walkthrough = spawn(process.execPath, [resolve(HERE, 'console-walkthrough.mjs')], {
  stdio: 'inherit',
  env: process.env,
});

walkthrough.on('exit', (code) => {
  stopAll();
  process.exit(code ?? 1);
});
