import { describe, expect, it } from 'vitest';
import {
  dateColumnFromString,
  dateColumnToString,
  istDateOf,
  istToUtc,
  istToday,
  istWeekday,
} from './ist';

describe('IST calendar helpers', () => {
  it('resolves the 00:30 IST case to today, not yesterday', () => {
    // 00:30 on 30 Aug IST is 19:00 on 29 Aug UTC. Taking the UTC date here is the
    // bug docs/Phases.md predicts: sessions generated for the previous day.
    const instant = new Date('2026-08-29T19:00:00.000Z');
    expect(instant.toISOString().slice(0, 10)).toBe('2026-08-29');
    expect(istDateOf(instant)).toBe('2026-08-30');
    expect(istToday(instant)).toBe('2026-08-30');
  });

  it('keeps 23:59 IST on the same day', () => {
    expect(istDateOf(new Date('2026-08-30T18:29:00.000Z'))).toBe('2026-08-30');
    expect(istDateOf(new Date('2026-08-30T18:30:00.000Z'))).toBe('2026-08-31');
  });

  it('converts a clock face to the instant it denotes', () => {
    // 10:00 IST == 04:30 UTC.
    expect(istToUtc('2026-08-30', '10:00').toISOString()).toBe('2026-08-30T04:30:00.000Z');
    // 00:15 IST is still the previous UTC day.
    expect(istToUtc('2026-08-30', '00:15').toISOString()).toBe('2026-08-29T18:45:00.000Z');
  });

  it('takes the weekday from the IST date, 0=Sunday', () => {
    expect(istWeekday('2026-08-30')).toBe(0); // a Sunday
    expect(istWeekday('2026-08-31')).toBe(1);
    // The weekday must follow the IST date, not the UTC one, for a late-night run.
    expect(istWeekday(istDateOf(new Date('2026-08-29T19:00:00.000Z')))).toBe(0);
  });

  it('round-trips a @db.Date column without shifting the day', () => {
    const written = dateColumnFromString('2026-08-30');
    expect(written.toISOString()).toBe('2026-08-30T00:00:00.000Z');
    expect(dateColumnToString(written)).toBe('2026-08-30');
  });
});
