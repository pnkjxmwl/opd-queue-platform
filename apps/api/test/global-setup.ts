import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { redact, toTestDatabaseUrl } from './use-test-database';

/**
 * Creates and migrates the test database once, before any test file runs.
 *
 * Runs in vitest's `globalSetup`, which executes in its own process before the
 * workers start - so the database exists by the time any test opens a connection.
 *
 * **No new dependency for this.** Creating a database needs a connection to a
 * *different* database (you cannot create the one you are connected to), which
 * normally means reaching for `pg`. Prisma can already do it: point a client at the
 * `postgres` maintenance database and issue the statement as raw SQL. `CREATE
 * DATABASE` cannot run inside a transaction, which is why this uses
 * `$executeRawUnsafe` rather than `$transaction`.
 */
export default async function setup(): Promise<void> {
  const devUrl = process.env.DATABASE_URL;
  if (devUrl === undefined || devUrl === '') {
    throw new Error('DATABASE_URL is not set - cannot prepare the test database');
  }

  const testUrl = toTestDatabaseUrl(devUrl);
  const name = new URL(testUrl).pathname.replace(/^\//, '');

  // Guard against a config mistake pointing the suite at real data. The suite
  // TRUNCATEs every table, so this check is the difference between a wasted run and
  // a catastrophe.
  if (!name.endsWith('_test')) {
    throw new Error(`refusing to prepare a database not named *_test: ${name}`);
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    const existing = await admin.$queryRawUnsafe<{ count: bigint }[]>(
      'SELECT count(*) AS count FROM pg_database WHERE datname = $1',
      name,
    );
    if (Number(existing[0]?.count ?? 0) === 0) {
      // The name is validated above and comes from our own DATABASE_URL, not from
      // user input; it still cannot be parameterised because CREATE DATABASE takes
      // an identifier, not a value. Quote it so an odd name cannot break out.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    }
  } catch (error) {
    throw new Error(
      `could not create the test database at ${redact(adminUrl.toString())}: ` +
        (error instanceof Error ? error.message : String(error)),
    );
  } finally {
    await admin.$disconnect();
  }

  // `migrate deploy`, never `migrate dev` - dev would try to author a new migration
  // and can reset the database (docs/Rules.md 5).
  // fileURLToPath, not URL.pathname - on Windows the latter yields "/C:/..." and a
  // space in the repo path stays percent-encoded, so the cwd does not exist and the
  // failure surfaces as a baffling ENOENT on cmd.exe rather than on the directory.
  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  execSync('pnpm exec prisma migrate deploy', {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'pipe',
  });
}
