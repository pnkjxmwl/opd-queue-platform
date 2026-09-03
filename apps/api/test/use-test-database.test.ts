import { describe, expect, it } from 'vitest';
import { redact, toTestDatabaseUrl } from './use-test-database';

/**
 * The rewrite that keeps the suite off the development database.
 *
 * Worth testing directly rather than trusting the integration run: a silent failure
 * here does not break a test, it truncates somebody's data. The failure this guards
 * against has already happened twice (docs/PROGRESS.md 2026-09-03).
 */
describe('toTestDatabaseUrl', () => {
  it('appends _test to the database name', () => {
    expect(toTestDatabaseUrl('postgresql://opd:pw@localhost:5433/opd?schema=public')).toBe(
      'postgresql://opd:pw@localhost:5433/opd_test?schema=public',
    );
  });

  it('leaves credentials, host, port and query string alone', () => {
    const out = new URL(toTestDatabaseUrl('postgresql://u:p@127.0.0.1:6000/db?a=1&b=2'));
    expect(out.username).toBe('u');
    expect(out.hostname).toBe('127.0.0.1');
    expect(out.port).toBe('6000');
    expect(out.search).toBe('?a=1&b=2');
  });

  it('is idempotent, so a re-entrant setup cannot produce opd_test_test', () => {
    const once = toTestDatabaseUrl('postgresql://opd:pw@localhost:5433/opd');
    expect(toTestDatabaseUrl(once)).toBe(once);
  });

  it('survives a password containing a slash, which defeats the obvious regex', () => {
    const out = toTestDatabaseUrl('postgresql://opd:a%2Fb@localhost:5433/opd');
    expect(new URL(out).pathname).toBe('/opd_test');
  });

  it('refuses a URL with no database name rather than inventing one', () => {
    expect(() => toTestDatabaseUrl('postgresql://opd:pw@localhost:5433')).toThrow(
      /no database name/,
    );
  });
});

describe('redact', () => {
  it('removes the password so a connection string can be logged', () => {
    expect(redact('postgresql://opd:hunter2@localhost:5433/opd')).toBe(
      'postgresql://opd:***@localhost:5433/opd',
    );
  });
});
