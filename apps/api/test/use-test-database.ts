/**
 * Points every test at `<database>_test` instead of the development database.
 *
 * **Why this exists.** `resetDb()` truncates every table between tests. Until now it
 * did that to the *development* database, on the reasoning - written into
 * `helpers.ts` - that local dev data is regenerable, so the cost of losing it is a
 * re-seed. That was true when the seed was two hospitals and no queue.
 *
 * It stopped being true. The seed is now six hospitals, 42 queue entries mid-clinic,
 * a patient account and a registered push token, and rebuilding it costs a truncate
 * that needs approval, a re-seed, a re-login on the phone and a fresh push
 * registration. The suite destroyed a working test environment twice in one day
 * (docs/PROGRESS.md 2026-09-03). `helpers.ts` said to give the suite its own
 * database "once seed data becomes expensive to rebuild" - this is that point.
 *
 * **Why a setup file and not an env var.** `DATABASE_URL` has to be rewritten before
 * `PrismaClient` is constructed. The client is built inside the Nest module, which
 * each test file creates for itself, so a `setupFiles` module - which vitest runs
 * before the file's imports execute - is early enough and needs nothing of the
 * developer. An env var in `.env.test` would work too, but only for people who
 * remembered to create it, and the failure mode of forgetting is losing your data.
 */
const DEV_URL = process.env.DATABASE_URL ?? '';

/**
 * Swaps the database name for `<name>_test`, leaving credentials, host, port and
 * query string untouched. Parsed as a URL rather than by regex because a password
 * containing `/` would defeat the obvious pattern.
 */
export function toTestDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, '');
  if (name === '') throw new Error(`DATABASE_URL has no database name: ${redact(url)}`);
  if (name.endsWith('_test')) return url;
  parsed.pathname = `/${name}_test`;
  return parsed.toString();
}

/** Never let a connection string reach a log or an error message intact. */
export function redact(url: string): string {
  return url.replace(/:[^:@/]*@/, ':***@');
}

if (DEV_URL !== '') {
  process.env.DATABASE_URL = toTestDatabaseUrl(DEV_URL);
}
