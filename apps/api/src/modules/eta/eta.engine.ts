import type { DeadTimeBasis, EtaBasis } from '@opd/contracts';

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

/**
 * The opening assumption for the gap between one consultation ending and the next
 * beginning, until the session has shown us its own. Two minutes: long enough to
 * call a name and have somebody walk in from a waiting area, short enough that it
 * does not dominate an estimate when it turns out to be wrong.
 *
 * A seed rather than zero, which is what the engine effectively assumed before. Zero
 * is not a neutral choice - it is a claim that handover is instantaneous, and it is
 * wrong in the direction that hurts: it tells patients to arrive early.
 */
export const SEED_DEAD_TIME_MIN = 2;

/**
 * A gap longer than this is not a handover.
 *
 * Doctors take breaks, step out, and sessions pause. Those show up in the same
 * arithmetic as turnaround and would drag an average up for the rest of the day -
 * one twenty-five minute lunch across six handovers adds four minutes to every
 * patient's estimate. Gaps above this are discarded rather than winsorised, because
 * they are a different event, not an extreme example of this one.
 */
export const MAX_CREDIBLE_GAP_MIN = 15;

/** Below this many handovers the measurement is noise; keep the seed. */
export const MIN_DEAD_TIME_SAMPLES = 2;

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

export interface DeadTimeResult {
  /** Minutes to add per patient ahead, on top of the consultation itself. */
  mins: number;
  basis: DeadTimeBasis;
  /** Credible handovers behind `mins`. 0 means the seed. */
  sampleSize: number;
}

/**
 * How long the queue takes to hand over from one patient to the next.
 *
 * `samples` are gap durations in minutes, each measured as one patient's call time
 * minus the previous patient's completion time - the interval where the room is
 * empty and nothing the engine used to model was happening.
 *
 * **Median, not mean.** The distribution is not symmetric: handovers cluster tightly
 * around a minute or two, and the outliers are all long ones (a break, a phone call,
 * a doctor stepping out). A mean chases those; a median ignores them. With the cap
 * below this is belt and braces, and deliberately so - the cost of overestimating
 * dead time is every patient in the queue told to arrive late.
 */
export function measureDeadTime(samples: readonly number[]): DeadTimeResult {
  const credible = samples.filter(
    (gap) => Number.isFinite(gap) && gap >= 0 && gap <= MAX_CREDIBLE_GAP_MIN,
  );

  if (credible.length < MIN_DEAD_TIME_SAMPLES) {
    return { mins: SEED_DEAD_TIME_MIN, basis: 'SEED', sampleSize: credible.length };
  }

  const sorted = [...credible].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;

  return { mins: median, basis: 'MEASURED', sampleSize: credible.length };
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
  deadTimeMins: number = SEED_DEAD_TIME_MIN,
): { from: Date; to: Date } {
  const expected = safePositive(expectedMins, FALLBACK_SEED_MIN);
  const ahead = Math.max(0, Math.floor(position.aheadCount));
  // Zero is a legitimate measurement here (a clinic that really does hand over
  // instantly), so this floors at zero rather than falling back to the seed the way
  // safePositive would.
  const dead =
    Number.isFinite(deadTimeMins) && deadTimeMins >= 0 ? deadTimeMins : SEED_DEAD_TIME_MIN;

  const elapsedMins = Math.max(0, (position.currentElapsedSec ?? 0) / 60);
  const remainingCurrent =
    position.currentElapsedSec === null
      ? 0
      : Math.max(MIN_REMAINING_MIN, expected - elapsedMins);

  // Every patient ahead costs a consultation AND a handover, and one more handover
  // separates the person in the room now from the first of them. An empty room owes
  // no handover - nobody has to leave it before the next patient is called.
  const handovers = position.currentElapsedSec === null ? ahead : ahead + 1;
  const etaMins = remainingCurrent + ahead * expected + handovers * dead;
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
