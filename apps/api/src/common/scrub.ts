/**
 * Strips personal data out of anything about to leave this process.
 *
 * **This is an egress guard, not a logging filter.** docs/Rules.md 10 says to log
 * access and scrub PII *from error reports* - those are two different things and
 * conflating them makes both worse. Local pino logs keep full detail: they live on
 * infrastructure we control, in-region, and a receptionist's bug is undebuggable
 * without knowing which hospital and which token. What must never leave is the
 * patient: a stack trace shipped to a third-party error service carries names, phone
 * numbers and dates of birth straight out of the country, and under DPDP that is a
 * compliance breach rather than an untidiness.
 *
 * So this runs at the boundary - Sentry's `beforeSend`, or any future exporter - and
 * nowhere else.
 *
 * **Key names, not value shapes.** Detecting "this looks like a phone number" fails
 * both ways: it misses `+91 98765 43210` written a new way, and it redacts a token
 * number that happens to be ten digits. Names are stable, greppable, and wrong in
 * only one direction - a new field is not scrubbed until it is listed, which is why
 * the list errs wide and includes `name` outright.
 */

/**
 * Redacted outright wherever they appear, at any depth.
 *
 * `name` is here even though it also catches hospital and department names. That is
 * the deliberate trade: losing "Apollo Clinic" from an error report costs a little
 * debugging context, while losing a patient's name from it is the entire point. The
 * request id in the same report is what ties it back to the full local log.
 */
const SENSITIVE_KEY = new RegExp(
  [
    'name', // patient, and deliberately everything else called name
    'phone',
    'mobile',
    'email',
    'dob',
    'dateofbirth',
    'abha', // India's health id - directly identifying
    'address',
    'password',
    'token',
    'secret',
    'authorization',
    'cookie',
    'signature',
    'otp',
  ].join('|'),
  'i',
);

/**
 * Keys that trip the list above but are not personal, checked first.
 *
 * `tokenLabel`, `tokenNumber` and `tokenPrefix` are the queue token - "B007" - which
 * is printed on a slip, read aloud in a waiting room and shown on a public board.
 * Redacting it makes an error report almost useless (which patient? the one whose
 * token is [redacted]) while protecting nothing. This collision is exactly why the
 * scrubber has tests: the first version silently removed the one field that made a
 * queue error legible.
 *
 * `filename` and `module` are the second collision, found the day this was actually
 * wired to Sentry (Phase 10): both contain "name", so every stack frame in every
 * report came back `"filename": "[redacted]"` - a stack with the function and the
 * line but not the file. They are server paths inside our own bundle, never
 * user-supplied. **If an upload path is ever added, a user-supplied filename must
 * not land on this key** - name it `originalFilename` or scrub it at the source.
 */
const NOT_SENSITIVE = /^(token(label|number|prefix)|filename|module)$/i;

export const REDACTED = '[redacted]';

/** Depth and breadth caps, so a cyclic or enormous payload cannot hang the exporter. */
const MAX_DEPTH = 8;
const MAX_ARRAY = 50;

/**
 * A structurally identical copy with sensitive values replaced.
 *
 * Never mutates its input: the caller is usually holding the same object it is about
 * to log locally in full, and scrubbing in place would silently redact the very logs
 * this function exists to preserve.
 */
export function scrub(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (value === null || typeof value !== 'object') return value;

  // A cycle is not an error here - request objects routinely contain one - so it is
  // marked and skipped rather than thrown on.
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((item) => scrub(item, depth + 1, seen));
    if (value.length > MAX_ARRAY) out.push(`[${value.length - MAX_ARRAY} more]`);
    return out;
  }

  // Errors are objects but not plain ones; keep the parts that identify the fault.
  if (value instanceof Error) {
    return { name: value.name, message: scrubText(value.message), stack: value.stack };
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const sensitive = !NOT_SENSITIVE.test(key) && SENSITIVE_KEY.test(key);
    out[key] = sensitive ? REDACTED : scrub(item, depth + 1, seen);
  }
  return out;
}

/**
 * Free text gets a narrower treatment: an error MESSAGE is often the only clue to
 * what went wrong, so it is kept, with the two patterns that are unambiguously
 * personal removed. Anything subtler belongs in the structured fields above, where
 * it is redacted by key.
 */
export function scrubText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, REDACTED)
    .replace(/(?:\+?91[-\s]?)?[6-9]\d{9}\b/g, REDACTED);
}

/**
 * Shaped for Sentry's `beforeSend`, and deliberately written before Sentry exists.
 *
 * The SDK is not installed yet - a dependency that does nothing until a DSN exists
 * is dead weight, and Phase 10 adds it alongside the deployment and the India-hosting
 * decision for the whole stack. What must exist NOW is this: the scrubbing, tested,
 * so that turning error reporting on is a configuration change rather than a moment
 * where somebody has to remember a compliance obligation under time pressure.
 */
export function scrubEvent<T>(event: T): T {
  return scrub(event) as T;
}
