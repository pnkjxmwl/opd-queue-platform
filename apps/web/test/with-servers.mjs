import { spawn, spawnSync } from 'node:child_process';
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
    // So a POSIX kill can signal the whole group rather than just the shell.
    detached: process.platform !== 'win32',
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

/**
 * `child.kill()` is not enough here.
 *
 * These are spawned with `shell: true`, so the child IS the shell and the server is
 * its grandchild. Killing the shell on Windows leaves that grandchild holding port
 * 3001 while answering nothing - a zombie that makes the NEXT run fail with
 * EADDRINUSE and a misleading "the console never came up". Found exactly that way.
 *
 * taskkill /T walks the tree on Windows; elsewhere a negative pid signals the
 * process group, which needs `detached` so the group exists in the first place.
 */
function stopAll() {
  for (const { child } of started) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    try {
      if (process.platform === 'win32') {
        // spawnSync, not spawn: this runs from a process 'exit' handler, which
        // cannot await anything - an async kill is simply never delivered, and the
        // server survives to break the next run.
        spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        process.kill(-child.pid, 'SIGTERM');
      }
    } catch {
      child.kill();
    }
  }
}

/**
 * Last resort only, and deliberately NOT the thorough version: Node forbids spawning
 * a process from an 'exit' handler, and libuv does not decline politely - it aborts
 * with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`. Every ordinary path
 * calls stopAll() while the event loop is still alive.
 */
process.on('exit', () => {
  for (const { child } of started) {
    if (child.exitCode === null) child.kill();
  }
});
process.on('SIGINT', () => {
  stopAll();
  process.exit(130);
});

const apiUp = await isUp(`http://localhost:${API_PORT}/health`);
const webUp = await isUp(`http://localhost:${WEB_PORT}/login`);

if (!apiUp) started.push(start('api', ['--filter', '@opd/api', 'start']));
// `start`, not `dev`: turbo runs this after the build, so serving the built output
// is both faster to boot and closer to what ships. It also keeps `next build` and a
// dev server off the same .next directory, which is what broke this the first time.
if (!webUp) started.push(start('web', ['--filter', '@opd/web', 'start']));

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
