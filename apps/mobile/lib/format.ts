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

/**
 * A UTC instant as its IST clock face, the way it is said out loud in India:
 * "7 PM", "6 AM", "10:30 AM".
 *
 * **12-hour, and the ":00" is dropped on the hour.** Clinics run on whole and half
 * hours, and "7 PM" is what a receptionist says to a patient - "19:00" is what a
 * server log says. This is a patient-facing app in a country that reads the clock
 * in twelve hours, so the display follows the country, not the storage.
 *
 * The instant itself is still UTC everywhere behind this (docs/Rules.md 5); only
 * the rendering changes.
 */
export function istClock(iso: string): string {
  const at = istShifted(iso);
  const hours = at.getUTCHours();
  const minutes = at.getUTCMinutes();
  const meridiem = hours < 12 ? 'AM' : 'PM';
  // 0 and 12 both read as 12 - midnight is "12 AM", noon is "12 PM".
  const twelve = hours % 12 === 0 ? 12 : hours % 12;

  return minutes === 0
    ? `${twelve} ${meridiem}`
    : `${twelve}:${String(minutes).padStart(2, '0')} ${meridiem}`;
}

/**
 * A session's working block, e.g. "10 AM–1 PM", or "10–11:30 AM" when both ends
 * fall in the same half of the day.
 *
 * Collapsing the repeated AM/PM is how a person writes it, and on a session card
 * every character competes with the doctor's name for the same line.
 */
export function istRange(startIso: string, endIso: string): string {
  const start = istClock(startIso);
  const end = istClock(endIso);
  const startMeridiem = start.slice(-2);

  return startMeridiem === end.slice(-2)
    ? `${start.slice(0, -3)}–${end}`
    : `${start}–${end}`;
}

/**
 * "Sun 30 Aug", from EITHER a calendar date ("2026-08-30") or a UTC instant.
 *
 * It accepts both on purpose. It used to take only the date-only form, and passing
 * an instant produced the string `"2026-08-31T11:27:30.000ZT00:00:00.000Z"` - an
 * Invalid Date whose parts render as **"undefined NaN undefined"** rather than
 * throwing. That reached a device. A formatter that silently prints `undefined` for
 * a plausible input is a trap, and the fix belongs here rather than at each caller,
 * because every caller would otherwise have to remember which shape it holds.
 *
 * An instant is converted to IST BEFORE the date is read: a session at 19:30 UTC is
 * the next day in Mumbai, and showing the UTC day would be off by one all evening -
 * every evening, which is exactly when an OPD clinic runs.
 */
export function calendarDate(date: string): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // A date-only string is pinned to UTC midnight so it can never shift a day; an
  // instant is shifted into IST so the day is the one the patient is living in.
  const at = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00.000Z`)
    : istShifted(date);
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
