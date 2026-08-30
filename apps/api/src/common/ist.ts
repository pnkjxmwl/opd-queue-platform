/**
 * Asia/Kolkata calendar arithmetic.
 *
 * docs/Phases.md calls the timezone the classic bug of this phase, so every
 * conversion between a clock face and an instant goes through here and nowhere
 * else. An inline `new Date()` in the session-generation path is the 00:30 IST
 * bug: run at 00:30 IST the UTC date is still yesterday, so "today's sessions"
 * would be generated for the wrong day, every night.
 *
 * IST is UTC+05:30 with no DST, ever - so a fixed offset is correct here and
 * pulling in a timezone library would buy nothing.
 */
const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;

/** The IST calendar date ("YYYY-MM-DD") an instant falls on. */
export function istDateOf(instant: Date): string {
  return new Date(instant.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE)
    .toISOString()
    .slice(0, 10);
}

/** Today in IST, as "YYYY-MM-DD". Server-side only - never trust a client's "today". */
export function istToday(now: Date = new Date()): string {
  return istDateOf(now);
}

/**
 * An IST calendar date + "HH:mm" clock face -> the UTC instant it denotes.
 *
 * Fixed-position slicing rather than split(): both formats are already guaranteed
 * by Zod AND by a database CHECK, and split() under `noUncheckedIndexedAccess`
 * yields `number | undefined` for values that cannot be missing.
 */
export function istToUtc(date: string, time: string): Date {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(3, 5));
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

/**
 * Weekday of an IST calendar date, 0=Sunday..6=Saturday - the encoding
 * DoctorSchedule.weekday uses.
 */
export function istWeekday(date: string): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Read a Prisma `@db.Date` column as "YYYY-MM-DD".
 *
 * Prisma hands these back as a JS Date pinned to UTC midnight, so this must slice
 * the ISO string. A locale formatter would shift the day on any machine behind UTC.
 */
export function dateColumnToString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Write "YYYY-MM-DD" to a Prisma `@db.Date` column. */
export function dateColumnFromString(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
