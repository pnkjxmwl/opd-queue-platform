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
   * When somebody joining right now would be seen. The same pair
   * `QueueSnapshot.joinNowEtaFrom/To` carries, repeated here so the console needs
   * one request rather than two. Null when the session cannot say - no doctor
   * present, or the session is over.
   */
  joinNowEtaFrom: z.string().datetime().nullable(),
  joinNowEtaTo: z.string().datetime().nullable(),
});
export type SessionEta = z.infer<typeof SessionEta>;
