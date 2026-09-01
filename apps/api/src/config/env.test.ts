import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

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
});
