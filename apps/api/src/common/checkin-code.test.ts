import { describe, expect, it } from 'vitest';
import { signCheckInCode, verifyCheckInCode } from './checkin-code';

/**
 * P6-BE-01's whole security claim: a code we did not issue is refused WITHOUT a
 * database lookup, and one we did issue survives being carried around on a phone.
 *
 * Pure, so both halves are testable with no Postgres and no session.
 */

const SECRET = 'checkin-secret-for-tests-0000000000';
const REF = 'Zm9vYmFyLXJlZmVyZW5jZS1iYXNlNjR1cmw';

describe('signed check-in code', () => {
  it('round-trips a reference', () => {
    expect(verifyCheckInCode(signCheckInCode(REF, SECRET), SECRET)).toBe(REF);
  });

  it('is stable across reads, so a screenshotted token keeps working', () => {
    // The signature is recomputed on every read of the entry. If it were salted or
    // time-based, a patient who screenshotted their token would arrive with a QR the
    // desk refuses - see the note on `checkInCode` in confirm-payment.ts.
    expect(signCheckInCode(REF, SECRET)).toBe(signCheckInCode(REF, SECRET));
  });

  it('stays short enough to scan off a phone screen', () => {
    expect(signCheckInCode(REF, SECRET).length).toBeLessThan(80);
  });

  it('rejects a tampered reference', () => {
    const signed = signCheckInCode(REF, SECRET);
    const [version, reference, signature] = signed.split('.');
    const tampered = `${version}.${reference.slice(0, -1)}X.${signature}`;
    expect(verifyCheckInCode(tampered, SECRET)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const signed = signCheckInCode(REF, SECRET);
    expect(verifyCheckInCode(signed.slice(0, -1) + 'X', SECRET)).toBeNull();
  });

  it('rejects a code signed with a different secret', () => {
    expect(verifyCheckInCode(signCheckInCode(REF, 'another-secret-0000000000000000000'), SECRET)).toBeNull();
  });

  it('rejects a bare unsigned reference', () => {
    // What Phase 5 put in the QR. It must not still be accepted, or the signature is
    // decoration - anyone holding a leaked reference could check in without it.
    expect(verifyCheckInCode(REF, SECRET)).toBeNull();
  });

  it('rejects a payload from a future version', () => {
    const signed = signCheckInCode(REF, SECRET);
    expect(verifyCheckInCode(`v2${signed.slice(2)}`, SECRET)).toBeNull();
  });

  it.each(['', '.', 'v1..sig', 'v1.ref.', 'v1.ref.sig.extra', 'garbage'])(
    'rejects malformed payload %j without throwing',
    (payload) => {
      expect(verifyCheckInCode(payload, SECRET)).toBeNull();
    },
  );
});
