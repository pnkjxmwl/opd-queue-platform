import { describe, expect, it } from 'vitest';
import { Email, LoginRequest, Password, SignupRequest } from './auth/dto';
import { CreatePatientRequest } from './patients/dto';

describe('auth schemas', () => {
  it('normalises email to trimmed lowercase', () => {
    expect(Email.parse('  Mixed.Case@Example.COM ')).toBe('mixed.case@example.com');
  });

  it('rejects a malformed email', () => {
    expect(Email.safeParse('not-an-email').success).toBe(false);
  });

  it('enforces a minimum password length on signup', () => {
    expect(Password.safeParse('short').success).toBe(false);
    expect(Password.safeParse('correct-horse-battery').success).toBe(true);
  });

  it('does NOT enforce the password policy on login', () => {
    // Applying signup's length rule here would leak the policy and reject
    // legacy passwords before the credentials are even checked.
    expect(LoginRequest.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
  });

  it('accepts an optional name on signup', () => {
    expect(SignupRequest.parse({ email: 'a@b.com', password: 'correct-horse-battery' }).name)
      .toBeUndefined();
  });
});

describe('patient schemas', () => {
  const base = { name: 'Asha' };

  it('defaults relation to SELF', () => {
    expect(CreatePatientRequest.parse(base).relation).toBe('SELF');
  });

  it('rejects a date of birth in the future', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const result = CreatePatientRequest.safeParse({ ...base, dob: tomorrow });
    expect(result.success).toBe(false);
  });

  it('accepts a past date of birth', () => {
    expect(CreatePatientRequest.safeParse({ ...base, dob: '2015-04-02T00:00:00.000Z' }).success)
      .toBe(true);
  });

  it('rejects an empty name', () => {
    expect(CreatePatientRequest.safeParse({ name: '   ' }).success).toBe(false);
  });
});
