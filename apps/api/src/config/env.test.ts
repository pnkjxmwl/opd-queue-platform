import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EnvSchema, loadEnv } from './env';

const valid = {
  DATABASE_URL: 'postgresql://opd:pw@localhost:5433/opd',
  REDIS_URL: 'redis://localhost:6380',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  CHECKIN_SECRET: 'c'.repeat(32),
};

describe('loadEnv', () => {
  it('applies defaults when optional vars are absent', () => {
    const env = loadEnv(valid as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT to a number', () => {
    const env = loadEnv({ ...valid, PORT: '8080' } as NodeJS.ProcessEnv);
    expect(env.PORT).toBe(8080);
  });

  it('refuses to boot when a required var is missing', () => {
    const { DATABASE_URL: _omitted, ...rest } = valid;
    expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it('refuses to boot on a too-short JWT secret', () => {
    expect(() =>
      loadEnv({ ...valid, JWT_ACCESS_SECRET: 'too-short' } as NodeJS.ProcessEnv),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses to boot without a check-in signing secret', () => {
    // Not defaulted on purpose: an unsigned QR scheme looks identical to a signed
    // one right up to the moment someone checks in with a code they invented.
    const { CHECKIN_SECRET: _omitted, ...rest } = valid;
    expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(/CHECKIN_SECRET/);
  });

  it('parses GOOGLE_CLIENT_IDS into a trimmed list', () => {
    expect(loadEnv({ ...valid, GOOGLE_CLIENT_IDS: ' a , b ,, ' } as NodeJS.ProcessEnv).GOOGLE_CLIENT_IDS)
      .toEqual(['a', 'b']);
    expect(loadEnv(valid as NodeJS.ProcessEnv).GOOGLE_CLIENT_IDS).toEqual([]);
  });

  it('refuses to boot on a malformed url', () => {
    expect(() => loadEnv({ ...valid, REDIS_URL: 'not-a-url' } as NodeJS.ProcessEnv)).toThrow(
      /REDIS_URL/,
    );
  });

  /**
   * Turbo 2 runs every task in a FILTERED environment: a variable not declared in
   * `turbo.json` is stripped before the task sees it. Locally that is invisible,
   * because `process.loadEnvFile()` reads `apps/api/.env` directly and bypasses
   * Turbo entirely - so the only place it shows up is CI, as a boot failure with a
   * message about a variable the workflow plainly sets.
   *
   * turbo.json has carried a comment warning about this since Phase 0, and Phase 6
   * added `CHECKIN_SECRET` and walked straight into it anyway. A comment is not a
   * mechanism. This is.
   */
  it('has every environment variable declared in turbo.json', () => {
    const raw = readFileSync(new URL('../../../../turbo.json', import.meta.url), 'utf8');
    // Line comments only - `$schema` contains a `//` inside a string.
    const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, '')) as {
      globalEnv?: string[];
      globalPassThroughEnv?: string[];
    };
    const declared = new Set([
      ...(config.globalEnv ?? []),
      ...(config.globalPassThroughEnv ?? []),
    ]);

    const missing = Object.keys(EnvSchema.shape).filter((name) => !declared.has(name));
    expect(missing, `add these to turbo.json globalPassThroughEnv: ${missing.join(', ')}`).toEqual(
      [],
    );
  });
});
