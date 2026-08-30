/**
 * Display formatting for values the API sends as UTC instants and integer paise.
 *
 * docs/Rules.md 5: the server stores UTC and paise; converting for Asia/Kolkata is
 * the client's job.
 */

/**
 * IST is UTC+05:30 with no DST, ever, so the offset is arithmetic rather than a
 * timezone database lookup. This deliberately mirrors apps/api/src/common/ist.ts:
 * both ends do the same fixed-offset maths, and neither needs `Intl` with a
 * `timeZone` option - which is the part of Intl that Hermes cannot be relied on
 * to ship. A hospital in Mumbai must read 10:00 on a phone set to London.
 */
const IST_OFFSET_MS = 330 * 60_000;

const istShifted = (iso: string): Date => new Date(new Date(iso).getTime() + IST_OFFSET_MS);

/** A UTC instant as its IST clock face, "HH:mm". */
export function istClock(iso: string): string {
  return istShifted(iso).toISOString().slice(11, 16);
}

/** The session's working block, e.g. "10:00–13:00". */
export function istRange(startIso: string, endIso: string): string {
  return `${istClock(startIso)}–${istClock(endIso)}`;
}

/** "2026-08-30" as "Sun 30 Aug". Used for a date that is not today. */
export function calendarDate(date: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const at = new Date(`${date}T00:00:00.000Z`);
  return `${days[at.getUTCDay()]} ${at.getUTCDate()} ${months[at.getUTCMonth()]}`;
}

/**
 * Paise to rupees. Fees are whole rupees in practice, and the decimal is noise on
 * a card, so it is dropped unless there really are paise.
 *
 * ponytail: `toLocaleString()` with no locale groups in threes (500 -> "500",
 * 2500 -> "2,500"), which matches Indian grouping for every value below ₹1,00,000.
 * An OPD consultation fee never gets near that. Pass 'en-IN' if it ever does - but
 * only once Intl is confirmed present on both platforms.
 */
export function rupees(paise: number): string {
  const whole = paise / 100;
  return `₹${Number.isInteger(whole) ? whole.toLocaleString() : whole.toFixed(2)}`;
}
