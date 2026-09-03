import { describe, expect, it } from 'vitest';
import {
  MAX_CREDIBLE_GAP_MIN,
  MIN_PAD_MIN,
  MIN_REMAINING_MIN,
  SEED_DEAD_TIME_MIN,
  blendExpectedMins,
  etaWindow,
  isRunningBehind,
  measureDeadTime,
} from './eta.engine';

/**
 * P7-BE-03 · the ETA engine.
 *
 * docs/CLAUDE.md 10 names this and the state machine as the two highest-risk pieces
 * of logic in the product, and this one is pure - no clock of its own, no database -
 * so there is no excuse for it not to be pinned exactly.
 *
 * The three cold cases docs/Phases.md asks for by name are the first three describes:
 * a doctor with no history, an idle doctor, and a doctor running long.
 */

const MIN = 60_000;
const at = (iso: string) => new Date(iso);
const T0 = at('2026-09-02T10:00:00.000Z');

describe('blendExpectedMins', () => {
  it('falls back to the seed when a doctor has no history at all', () => {
    // The cold start. docs/Phases.md, verbatim: "never divide by zero".
    const result = blendExpectedMins({
      seedMins: 15,
      allTimeMins: null,
      allTimeSamples: 0,
      todayMins: null,
      todaySamples: 0,
    });
    expect(result.mins).toBe(15);
    expect(result.basis).toBe('SEED');
    expect(result.sampleSize).toBe(0);
  });

  it('renormalises over the terms that exist, rather than treating a missing one as zero', () => {
    // Seed 10 and all-time 20, weights 0.2 and 0.3 -> (0.2*10 + 0.3*20) / 0.5 = 16.
    // Dividing by the full 1.0 instead would give 8 - LOWER than either input, which
    // is the bug this renormalisation exists to prevent.
    const result = blendExpectedMins({
      seedMins: 10,
      allTimeMins: 20,
      allTimeSamples: 9,
      todayMins: null,
      todaySamples: 0,
    });
    expect(result.mins).toBeCloseTo(16, 5);
    expect(result.mins).toBeGreaterThanOrEqual(10);
    expect(result.mins).toBeLessThanOrEqual(20);
    expect(result.basis).toBe('DOCTOR_HISTORY');
    expect(result.sampleSize).toBe(9);
  });

  it('weights today highest once today has anything to say', () => {
    const base = { seedMins: 10, allTimeMins: 10, allTimeSamples: 20 };
    const slowToday = blendExpectedMins({ ...base, todayMins: 30, todaySamples: 4 });
    const fastToday = blendExpectedMins({ ...base, todayMins: 5, todaySamples: 4 });

    expect(slowToday.basis).toBe('TODAY');
    // 0.5*30 + 0.3*10 + 0.2*10 = 20
    expect(slowToday.mins).toBeCloseTo(20, 5);
    expect(fastToday.mins).toBeCloseTo(7.5, 5);

    // "Weighted highest" stated as the thing it actually means: the same change to
    // today moves the estimate more than that change to any other term.
    const flat = { seedMins: 10, allTimeMins: 10, allTimeSamples: 20, todayMins: 10, todaySamples: 4 };
    const level = blendExpectedMins(flat).mins;
    const todayRaised = blendExpectedMins({ ...flat, todayMins: 20 }).mins;
    const historyRaised = blendExpectedMins({ ...flat, allTimeMins: 20 }).mins;
    const seedRaised = blendExpectedMins({ ...flat, seedMins: 20 }).mins;

    expect(todayRaised - level).toBeGreaterThan(historyRaised - level);
    expect(todayRaised - level).toBeGreaterThan(seedRaised - level);
  });

  it('counts every consultation it learned from, so the UI can say how sure it is', () => {
    const result = blendExpectedMins({
      seedMins: 10,
      allTimeMins: 12,
      allTimeSamples: 40,
      todayMins: 14,
      todaySamples: 6,
    });
    expect(result.sampleSize).toBe(40);
  });

  it('never returns zero, a negative, or a NaN, whatever it is handed', () => {
    for (const seedMins of [0, -5, Number.NaN]) {
      const result = blendExpectedMins({
        seedMins,
        allTimeMins: null,
        allTimeSamples: 0,
        todayMins: null,
        todaySamples: 0,
      });
      expect(Number.isFinite(result.mins)).toBe(true);
      expect(result.mins).toBeGreaterThan(0);
    }
  });
});

describe('etaWindow', () => {
  it('is a window, never a point (docs/Phases.md)', () => {
    const { from, to } = etaWindow(10, { aheadCount: 2, currentElapsedSec: null }, T0);
    expect(to.getTime()).toBeGreaterThan(from.getTime());
    expect(to.getTime() - from.getTime()).toBeGreaterThanOrEqual(2 * MIN_PAD_MIN * MIN);
  });

  it('puts the middle of the window at remaining + ahead x expected', () => {
    // Nobody in the room, three ahead, 10 minutes each -> centred 30 minutes out.
    // Dead time passed as 0 so this measures the consultation arithmetic alone; the
    // handover term has its own tests below.
    const { from, to } = etaWindow(10, { aheadCount: 3, currentElapsedSec: null }, T0, 0);
    const midpoint = (from.getTime() + to.getTime()) / 2;
    expect(midpoint - T0.getTime()).toBeCloseTo(30 * MIN, -2);
  });

  it('subtracts the time the current patient has already been in the room', () => {
    const centre = (w: { from: Date; to: Date }) => (w.from.getTime() + w.to.getTime()) / 2;
    const fresh = etaWindow(20, { aheadCount: 1, currentElapsedSec: 0 }, T0);
    const halfway = etaWindow(20, { aheadCount: 1, currentElapsedSec: 10 * 60 }, T0);

    // Ten minutes already spent means ten fewer minutes to wait. Measured at the
    // CENTRE: the window also narrows as the wait shortens, so `from` moves by less
    // than ten minutes and comparing it would be measuring two effects at once.
    expect(centre(fresh) - centre(halfway)).toBeCloseTo(10 * MIN, -2);
    expect(halfway.to.getTime() - halfway.from.getTime()).toBeLessThan(
      fresh.to.getTime() - fresh.from.getTime(),
    );
  });

  it('floors the current consultation rather than letting it go negative', () => {
    // The doctor is running LONG - 40 minutes into a 10-minute estimate. Without a
    // floor this subtracts 30 minutes and predicts a time already in the past.
    const { from } = etaWindow(10, { aheadCount: 1, currentElapsedSec: 40 * 60 }, T0);
    const earliest = T0.getTime() + (MIN_REMAINING_MIN + 10) * MIN - 30 * MIN;
    expect(from.getTime()).toBeGreaterThanOrEqual(Math.min(earliest, T0.getTime()));
    expect(from.getTime()).toBeGreaterThanOrEqual(T0.getTime() - MIN);
  });

  it('drifts LATER on every tick while the doctor is idle', () => {
    // The case docs/Phases.md calls out: nothing about the queue changes, only the
    // clock. A patient watching this screen must see the window move away from them,
    // because it is anchored to now and the queue is not moving.
    const queue = { aheadCount: 2, currentElapsedSec: null };
    const early = etaWindow(10, queue, T0);
    const later = etaWindow(10, queue, new Date(T0.getTime() + 10 * MIN));

    expect(later.from.getTime()).toBeGreaterThan(early.from.getTime());
    expect(later.from.getTime() - early.from.getTime()).toBe(10 * MIN);
  });

  it('also drifts later while one consultation overruns', () => {
    const early = etaWindow(10, { aheadCount: 1, currentElapsedSec: 30 * 60 }, T0);
    const later = etaWindow(
      10,
      { aheadCount: 1, currentElapsedSec: 40 * 60 },
      new Date(T0.getTime() + 10 * MIN),
    );
    expect(later.from.getTime()).toBeGreaterThan(early.from.getTime());
  });

  it('starts at now for the first person when the room is empty', () => {
    const { from, to } = etaWindow(10, { aheadCount: 0, currentElapsedSec: null }, T0);
    // Centred on now, so the window opens before it - clamped, because telling
    // somebody they will be seen in the past is worse than telling them "now".
    expect(from.getTime()).toBeGreaterThanOrEqual(T0.getTime());
    expect(to.getTime()).toBeGreaterThan(T0.getTime());
  });

  it('widens the window as the wait grows, but never without limit', () => {
    const near = etaWindow(10, { aheadCount: 1, currentElapsedSec: null }, T0);
    const far = etaWindow(10, { aheadCount: 30, currentElapsedSec: null }, T0);
    const width = (w: { from: Date; to: Date }) => w.to.getTime() - w.from.getTime();

    expect(width(far)).toBeGreaterThan(width(near));
    expect(width(far)).toBeLessThanOrEqual(2 * 30 * MIN);
  });

  it('treats a nonsense queue as an empty one rather than producing a nonsense time', () => {
    const { from, to } = etaWindow(10, { aheadCount: -3, currentElapsedSec: -50 }, T0);
    expect(from.getTime()).toBeGreaterThanOrEqual(T0.getTime());
    expect(Number.isFinite(to.getTime())).toBe(true);
  });
});

describe('measureDeadTime', () => {
  it('keeps the seed when the session has shown nothing yet', () => {
    const result = measureDeadTime([]);
    expect(result.mins).toBe(SEED_DEAD_TIME_MIN);
    expect(result.basis).toBe('SEED');
    expect(result.sampleSize).toBe(0);
  });

  it('keeps the seed on a single handover, which is an anecdote', () => {
    expect(measureDeadTime([4]).basis).toBe('SEED');
  });

  it('measures the median once there is enough to go on', () => {
    const result = measureDeadTime([1, 3, 2]);
    expect(result.mins).toBe(2);
    expect(result.basis).toBe('MEASURED');
    expect(result.sampleSize).toBe(3);
  });

  it('averages the middle pair when the count is even', () => {
    expect(measureDeadTime([1, 2, 3, 4]).mins).toBe(2.5);
  });

  it('is not dragged up by a lunch break', () => {
    // Five quick handovers and one 40-minute gap. The mean is over 8 minutes; the
    // median is 2. With eight people ahead that difference is nearly an hour of
    // invented waiting.
    const withBreak = measureDeadTime([2, 1, 2, 3, 2, 40]);
    expect(withBreak.mins).toBe(2);
    // The break is discarded outright, not merely outvoted.
    expect(withBreak.sampleSize).toBe(5);
  });

  it('discards gaps beyond the credible cap as a different kind of event', () => {
    const result = measureDeadTime([MAX_CREDIBLE_GAP_MIN + 0.1, 60, 90]);
    expect(result.basis).toBe('SEED');
    expect(result.sampleSize).toBe(0);
  });

  it('accepts an instant handover as a real measurement, not a missing one', () => {
    // A clinic where the next patient is already at the door. Zero is a fact here,
    // and must not be mistaken for "no data" and replaced by the seed.
    const result = measureDeadTime([0, 0, 0]);
    expect(result.mins).toBe(0);
    expect(result.basis).toBe('MEASURED');
  });

  it('ignores impossible gaps rather than trusting the clock', () => {
    // Negative or non-finite gaps mean clock skew or a bad row, not a fast clinic.
    const result = measureDeadTime([-5, Number.NaN, Number.POSITIVE_INFINITY, 2, 2]);
    expect(result.mins).toBe(2);
    expect(result.sampleSize).toBe(2);
  });
});

describe('etaWindow with dead time', () => {
  const centre = (w: { from: Date; to: Date }) => (w.from.getTime() + w.to.getTime()) / 2;

  it('charges a handover for every patient ahead', () => {
    // Three ahead at 10 minutes, 2 minutes of handover each, empty room.
    // 3 x 10 + 3 x 2 = 36.
    const w = etaWindow(10, { aheadCount: 3, currentElapsedSec: null }, T0, 2);
    expect(centre(w) - T0.getTime()).toBeCloseTo(36 * MIN, -2);
  });

  it('charges one extra handover when somebody is still in the room', () => {
    // The person in there has to leave before the next is called, so four handovers
    // for three ahead: 10 remaining + 3 x 10 + 4 x 2 = 48.
    const w = etaWindow(10, { aheadCount: 3, currentElapsedSec: 0 }, T0, 2);
    expect(centre(w) - T0.getTime()).toBeCloseTo(48 * MIN, -2);
  });

  it('charges nothing extra for an empty room and an empty queue', () => {
    // Nobody has to leave the room and nobody is ahead, so there is no handover to
    // pay for and the size of the dead-time figure must not matter at all.
    // Asserted as "identical to dead time 0" rather than "centred on now", because
    // an empty queue clamps `from` to now and that skews the window's own midpoint.
    const generous = etaWindow(10, { aheadCount: 0, currentElapsedSec: null }, T0, 5);
    const none = etaWindow(10, { aheadCount: 0, currentElapsedSec: null }, T0, 0);
    expect(generous.from.getTime()).toBe(none.from.getTime());
    expect(generous.to.getTime()).toBe(none.to.getTime());
  });

  it('makes the estimate LATER than the old formula, never earlier', () => {
    // The whole point of the change. The previous engine assumed instant handover,
    // which is what dead time 0 reproduces.
    const position = { aheadCount: 8, currentElapsedSec: 5 * 60 };
    const before = etaWindow(12, position, T0, 0);
    const after = etaWindow(12, position, T0, 3);
    expect(centre(after)).toBeGreaterThan(centre(before));
    // Eight ahead plus the one in the room = nine handovers x 3 minutes.
    expect(centre(after) - centre(before)).toBeCloseTo(27 * MIN, -2);
  });

  it('falls back to the seed on a nonsense value rather than dropping the term', () => {
    const nonsense = etaWindow(10, { aheadCount: 2, currentElapsedSec: null }, T0, Number.NaN);
    const seeded = etaWindow(10, { aheadCount: 2, currentElapsedSec: null }, T0, SEED_DEAD_TIME_MIN);
    expect(centre(nonsense)).toBe(centre(seeded));
  });

  it('uses the seed when no dead time is supplied at all', () => {
    const implicit = etaWindow(10, { aheadCount: 2, currentElapsedSec: null }, T0);
    const explicit = etaWindow(10, { aheadCount: 2, currentElapsedSec: null }, T0, SEED_DEAD_TIME_MIN);
    expect(centre(implicit)).toBe(centre(explicit));
  });
});

describe('isRunningBehind', () => {
  it('is false with nothing to compare against', () => {
    expect(isRunningBehind({ todayMins: null, todaySamples: 0, baselineMins: 10 })).toBe(false);
  });

  it('is false on a single consultation - one slow patient is not a trend', () => {
    expect(isRunningBehind({ todayMins: 40, todaySamples: 1, baselineMins: 10 })).toBe(false);
  });

  it('is true once today is materially slower than usual, over enough patients', () => {
    expect(isRunningBehind({ todayMins: 18, todaySamples: 5, baselineMins: 10 })).toBe(true);
  });

  it('is false when today is merely a little slower', () => {
    expect(isRunningBehind({ todayMins: 11, todaySamples: 5, baselineMins: 10 })).toBe(false);
  });

  it('is false when today is FASTER, which is not a health problem', () => {
    expect(isRunningBehind({ todayMins: 4, todaySamples: 5, baselineMins: 10 })).toBe(false);
  });
});
