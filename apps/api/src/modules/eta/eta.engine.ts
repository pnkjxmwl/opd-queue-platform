import type { EtaBasis } from '@opd/contracts';

/**
 * P7-BE-03 · the ETA engine (docs/Architecture.md 8).
 *
 * **Pure.** No Prisma, no `new Date()`, no configuration lookups - inputs in, numbers
 * out. That is what makes the cold cases testable at all: "an idle doctor's window
 * drifts later" is two calls with different clocks, not a fixture and a wait.
 *
 * It is also, deliberately, arithmetic rather than a model. docs/Architecture.md 18
 * defers ML to v2 once there is event data to learn from; what this needs to do
 * today is be *honest* - a window rather than a promise, widening with the wait, and
 * saying out loud when it is guessing.
 */

/** Weights of the three estimates. Today counts for most: it is this clinic, today. */
const WEIGHT = { today: 0.5, allTime: 0.3, seed: 0.2 } as const;

/** Used when a doctor has no `defaultConsultMins` worth believing. */
const FALLBACK_SEED_MIN = 10;

/**
 * A consultation in progress is never treated as about to end. Without this floor an
 * overrunning doctor produces a window in the past, which reads as "you have missed
 * it" to the one patient who has not.
 */
export const MIN_REMAINING_MIN = 2;

/** The window is never tighter than this either side - an exact minute is a lie. */
export const MIN_PAD_MIN = 5;
/** ...and never vaguer than this, or it stops being information. */
export const MAX_PAD_MIN = 30;
/** Uncertainty grows with the wait: a two-hour estimate deserves a wider window. */
const PAD_FRACTION = 0.25;

/**
 * Today must be this much slower than the doctor's usual pace before staff are told
 * the queue is running behind, over at least MIN_BEHIND_SAMPLES patients. One slow
 * consultation is a patient, not a trend, and a flag that cries wolf gets ignored.
 */
const BEHIND_RATIO = 1.25;
const MIN_BEHIND_SAMPLES = 3;

const MS_PER_MIN = 60_000;

/** A positive, finite number, or the fallback. Guards every input from the database. */
const safePositive = (value: number | null | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;

export interface ExpectedInputs {
  /** `Doctor.defaultConsultMins` - the seed that always exists. */
  seedMins: number;
  /** Mean of this doctor's completed consultations, ever. Null when there are none. */
  allTimeMins: number | null;
  allTimeSamples: number;
  /** Mean of this doctor's consultations today. Null before the first one finishes. */
  todayMins: number | null;
  todaySamples: number;
}

export interface ExpectedResult {
  mins: number;
  basis: EtaBasis;
  /** How many real consultations are behind the number. 0 means it is a guess. */
  sampleSize: number;
}

/**
 * Blend the three estimates into one expected consultation length.
 *
 * **Renormalised over the terms that actually exist.** Treating a missing term as
 * zero would drag the estimate below every input it was given - a doctor with a
 * 20-minute average and no data for today would come out at 8 minutes. So the
 * weights of the present terms are divided by their own sum, and the result is
 * always between the smallest and largest input.
 */
export function blendExpectedMins(input: ExpectedInputs): ExpectedResult {
  const seed = safePositive(input.seedMins, FALLBACK_SEED_MIN);
  const allTime = input.allTimeSamples > 0 ? safePositive(input.allTimeMins, seed) : null;
  const today = input.todaySamples > 0 ? safePositive(input.todayMins, seed) : null;

  let weighted = WEIGHT.seed * seed;
  let total = WEIGHT.seed;

  if (allTime !== null) {
    weighted += WEIGHT.allTime * allTime;
    total += WEIGHT.allTime;
  }
  if (today !== null) {
    weighted += WEIGHT.today * today;
    total += WEIGHT.today;
  }

  return {
    mins: weighted / total,
    // What it MOSTLY stands on, most-informed first. Reported rather than inferred
    // by the client, so every surface says the same thing about the same number.
    basis: today !== null ? 'TODAY' : allTime !== null ? 'DOCTOR_HISTORY' : 'SEED',
    // The all-time count, not the sum: today's consultations are already inside it,
    // and adding them would double-count the same visits.
    sampleSize: Math.max(0, input.allTimeSamples),
  };
}

export interface QueuePosition {
  /** Eligible patients who will be called before this one. */
  aheadCount: number;
  /** Seconds the patient currently in the room has been in it. Null if nobody is. */
  currentElapsedSec: number | null;
}

/**
 * When this patient will be seen, as a window.
 *
 * Anchored to `now`, which is what makes an idle queue drift: nothing about the
 * inputs changes, the clock does, and the window slides away from the patient
 * exactly as their real wait is doing.
 */
export function etaWindow(
  expectedMins: number,
  position: QueuePosition,
  now: Date,
): { from: Date; to: Date } {
  const expected = safePositive(expectedMins, FALLBACK_SEED_MIN);
  const ahead = Math.max(0, Math.floor(position.aheadCount));

  const elapsedMins = Math.max(0, (position.currentElapsedSec ?? 0) / 60);
  const remainingCurrent =
    position.currentElapsedSec === null
      ? 0
      : Math.max(MIN_REMAINING_MIN, expected - elapsedMins);

  const etaMins = remainingCurrent + ahead * expected;
  const pad = Math.min(MAX_PAD_MIN, Math.max(MIN_PAD_MIN, PAD_FRACTION * etaMins));

  const centre = now.getTime() + etaMins * MS_PER_MIN;
  return {
    // Never opens in the past: "you have missed your slot" is the one thing this
    // must not accidentally say.
    from: new Date(Math.max(now.getTime(), centre - pad * MS_PER_MIN)),
    to: new Date(centre + pad * MS_PER_MIN),
  };
}

/**
 * "Running slower than usual" (docs/PRD.md 195) - a staff-facing flag.
 *
 * Compared against the doctor's own baseline, not against a platform average: a
 * cardiologist taking twenty minutes is not behind, and a dermatologist taking
 * twenty minutes is.
 */
export function isRunningBehind(input: {
  todayMins: number | null;
  todaySamples: number;
  baselineMins: number;
}): boolean {
  if (input.todayMins === null || input.todaySamples < MIN_BEHIND_SAMPLES) return false;
  const baseline = safePositive(input.baselineMins, FALLBACK_SEED_MIN);
  return input.todayMins >= baseline * BEHIND_RATIO;
}
