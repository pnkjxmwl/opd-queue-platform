import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * The signed check-in QR (P6-BE-01, docs/Rules.md 10, docs/PRD.md 6.3).
 *
 * `QueueEntry.checkInCode` stores 24 random bytes, minted once when payment is
 * confirmed and never rotated - a patient may have screenshotted their token. That
 * reference is already opaque, non-enumerable and free of PII. What it was missing is
 * a SIGNATURE, so this wraps it:
 *
 *     v1.<stored reference>.<hmac over "v1.<reference>">
 *
 * **Signed on read, verified before any database access.** A tampered or invented
 * code costs one hash and is refused; without this, every garbage scan at a busy
 * reception desk is a query against a unique index, and a patient attacker gets an
 * oracle that tells them when they have guessed a real code.
 *
 * **Why the reference is not the entry id.** docs/Phases.md is explicit that the
 * payload must carry "no raw entry id that could be enumerated or forged". Keeping
 * the random reference also keeps `unique(checkInCode)` as the lookup - the index the
 * check-in command has used since Phase 4 - so the signature is added without
 * changing what a code MEANS or invalidating a single issued token.
 *
 * Everything here is pure apart from the default secret, which follows the seam the
 * rest of the codebase uses (`checkoutReturnUrl(config = env())`): callers pass
 * nothing, tests pass a secret.
 */

/**
 * Bumping this invalidates every issued QR at once, which is the point of having it:
 * if the scheme ever has to change, old codes must fail closed rather than be
 * silently accepted by a verifier that no longer means the same thing.
 */
const VERSION = 'v1';

/**
 * 132 bits of the HMAC, base64url. Forging one is not feasible, and the whole payload
 * stays around 57 characters - short enough to scan reliably off a phone screen with
 * a cheap camera, which docs/Phases.md names as a real constraint.
 */
const SIG_CHARS = 22;

const signatureFor = (signedPart: string, secret: string): string =>
  createHmac('sha256', secret).update(signedPart).digest('base64url').slice(0, SIG_CHARS);

/** The value that goes into the QR. */
export function signCheckInCode(reference: string, secret: string = env().CHECKIN_SECRET): string {
  const signedPart = `${VERSION}.${reference}`;
  return `${signedPart}.${signatureFor(signedPart, secret)}`;
}

/**
 * The stored reference a scanned payload refers to, or null if it is not ours.
 *
 * Null covers every rejection - wrong version, wrong shape, bad signature - because
 * the caller must answer all of them identically. Telling a scanner WHICH part was
 * wrong is how a guessing attack makes progress.
 */
export function verifyCheckInCode(
  payload: string,
  secret: string = env().CHECKIN_SECRET,
): string | null {
  // The reference is base64url and contains no dot, so a real payload has exactly
  // three parts. Anything else is not a code we issued.
  const [version, reference, signature, ...rest] = payload.split('.');
  if (rest.length > 0) return null;
  if (version !== VERSION || !reference || !signature) return null;

  const expected = signatureFor(`${version}.${reference}`, secret);
  // Length guard first: timingSafeEqual THROWS on a length mismatch rather than
  // returning false, so an attacker could distinguish "wrong length" from "wrong
  // signature" by the shape of the failure. Same guard as verifyWebhookSignature.
  if (signature.length !== expected.length) return null;

  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? reference : null;
}
