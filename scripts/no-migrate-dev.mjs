/**
 * Refuses `prisma migrate dev` / `migrate reset` against anything but a local database.
 *
 * Both rewrite history and `reset` DROPS EVERY ROW. `migrate deploy` is the only
 * safe one against a deployed environment (docs/Rules.md 5, Phase 10's first risk).
 * The phase doc asks for a guard rather than a thing you remember, and this is it.
 *
 * It refuses on the HOST, not on NODE_ENV: the accident this exists to stop is a
 * local shell with a staging DATABASE_URL pasted into it, where NODE_ENV is still
 * "development" and every other signal says you are at home.
 */
const url = process.env.DATABASE_URL ?? '';

// No URL at all is not this script's problem - env.ts fails loudly on it, and
// blocking here would only hide that clearer error behind a vaguer one.
if (url !== '') {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    console.error(`DATABASE_URL is not a URL. Refusing to run a destructive migration.`);
    process.exit(1);
  }

  const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);
  if (!LOCAL.has(host)) {
    console.error(
      `\nRefusing to run a destructive migration against "${host}".\n\n` +
        `  migrate dev rewrites migration history; migrate reset DROPS EVERY ROW.\n` +
        `  Against a deployed database the only safe command is:\n\n` +
        `      pnpm --filter @opd/api prisma:deploy\n\n` +
        `  If this really is a throwaway database, run prisma directly:\n\n` +
        `      pnpm --filter @opd/api exec prisma migrate dev\n`,
    );
    process.exit(1);
  }
}
