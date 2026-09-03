import { z } from 'zod';

/**
 * P7-CONTRACT-01 · what the ETA engine knows, for the people running the clinic.
 *
 * Patients never see this. Their ETA arrives as a **window** on shapes that already
 * exist - `QueueSnapshot.joinNowEtaFrom/To` for "if I joined now", and
 * `MyQueueEntry.etaFrom/To` for "when will I be seen". Both have been nullable since
 * Phase 3 precisely so this phase could fill them without changing a shipped app.
 *
 * This shape is the staff-side view of the same engine: what it is estimating from,
 * how much it has to go on, and whether today is running behind - which docs/PRD.md
 * 195 asks for as *"queue health, for staff visibility"*.
 */

/**
 * What the estimate is mostly standing on. Reported rather than hidden, because a
 * number with no history behind it and a number drawn from forty consultations are
 * not the same claim, and a doctor deciding whether to trust it deserves to know
 * which one they are looking at.
 */
export const EtaBasis = z.enum([
  /** No consultations at all. `Doctor.defaultConsultMins`, and say so. */
  'SEED',
  /** This doctor has history, but none from today yet. */
  'DOCTOR_HISTORY',
  /** Today's own pace is contributing, and it is weighted highest. */
  'TODAY',
]);
export type EtaBasis = z.infer<typeof EtaBasis>;

/**
 * How much the dead-time figure has behind it.
 *
 * Deliberately only two values, unlike `EtaBasis`. Turnaround is a property of the
 * room and the clinic on the day - who is fetching patients, how far the waiting
 * area is - far more than of the doctor, so a doctor's history from last month says
 * little about this morning. Either this session has shown us its own handovers or
 * it has not.
 */
export const DeadTimeBasis = z.enum([
  /** No completed handovers yet. The opening assumption, and say so. */
  'SEED',
  /** Measured from handovers in this session. */
  'MEASURED',
]);
export type DeadTimeBasis = z.infer<typeof DeadTimeBasis>;

export const SessionEta = z.object({
  sessionId: z.string().uuid(),

  /** The blended per-patient estimate the windows are built from. */
  expectedConsultMins: z.number().positive(),
  basis: EtaBasis,
  /** Consultations that fed the estimate. 0 means SEED, and the UI should say so. */
  sampleSize: z.number().int().nonnegative(),

  /**
   * Today is running materially slower than this doctor's usual pace
   * (docs/PRD.md 195). A flag rather than a percentage: staff need to know *whether*
   * to warn the room, and a precise figure invites arguing with it.
   */
  runningBehind: z.boolean(),

  /**
   * The gap between consultations, which the estimate used to ignore entirely.
   *
   * A queue does not advance the instant a consultation ends: the next patient has
   * to walk in from the waiting room, and the doctor needs a moment between them.
   * Modelling only time *inside* the room made every estimate optimistic by roughly
   * this much per person ahead - with eight ahead and three minutes of gap, twenty
   * four unaccounted minutes, and a patient told to arrive before they needed to.
   *
   * Surfaced rather than hidden because staff comparing the board against the clock
   * deserve to see which part of the estimate is consultation and which is
   * turnaround - and because a turnaround that climbs through the day is a real
   * signal about how the clinic is running.
   */
  deadTimeMins: z.number().nonnegative(),
  /**
   * Whether `deadTimeMins` was measured from this session or is still the opening
   * assumption. Same honesty as `basis` above: a number with nothing behind it and
   * a number drawn from a dozen handovers are not the same claim.
   */
  deadTimeBasis: DeadTimeBasis,
  /**
   * Credible handovers observed in this session so far.
   *
   * Counts what was *seen*, not what was used, so it can be non-zero while the basis
   * is still SEED - one handover is an anecdote and the engine says so rather than
   * pretending a single measurement is a rate. Reading "SEED, 1 sample" tells staff
   * the estimate is about to start learning; reading "SEED, 0" tells them nothing
   * has finished yet.
   */
  deadTimeSamples: z.number().int().nonnegative(),

  /**
   * When somebody joining right now would be seen. The same pair
   * `QueueSnapshot.joinNowEtaFrom/To` carries, repeated here so the console needs
   * one request rather than two. Null when the session cannot say - no doctor
   * present, or the session is over.
   */
  joinNowEtaFrom: z.string().datetime().nullable(),
  joinNowEtaTo: z.string().datetime().nullable(),
});
export type SessionEta = z.infer<typeof SessionEta>;
