import { z } from 'zod';

/**
 * OPD session lifecycle. docs/PRD.md 8.10.
 *
 * Deliberately INDEPENDENT of DoctorPresence: a doctor being late, on a break or
 * gone must never change the session's status, and vice versa. Conflating the two
 * is the classic modelling mistake here - it makes "session is ACTIVE but nobody
 * is in the room" unrepresentable, which is a state that happens every single day.
 *
 * Legal transitions live in the Phase-4 state machine, NOT here.
 */
export const SessionStatus = z.enum([
  'SCHEDULED',
  'OPEN_FOR_REGISTRATION',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'ENDED_EARLY',
]);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** Where the doctor physically is. docs/PRD.md 8.10 - tracked separately from SessionStatus. */
export const DoctorPresence = z.enum(['NOT_PRESENT', 'PRESENT', 'ON_BREAK', 'LEFT']);
export type DoctorPresence = z.infer<typeof DoctorPresence>;

/**
 * How the engine orders the checked-in pool. docs/PRD.md 8.3 locks v1 to token
 * order (earliest booking first), with audited priority/emergency insertions on top.
 *
 * One value on purpose. The column exists because PRD 8.5 says the policy - not the
 * engine - decides ordering, so the decision has a home. Adding a value later is an
 * additive `ALTER TYPE ... ADD VALUE`, which is cheap; changing what the engine
 * *means* by ordering is not, which is why the semantics are pinned here now.
 */
export const OrderingStrategy = z.enum(['TOKEN_ORDER']);
export type OrderingStrategy = z.infer<typeof OrderingStrategy>;

/**
 * What happens to a patient who was called and did not appear, after the grace
 * period and every recall attempt is spent. docs/PRD.md 8.8 ("move to end") is the
 * default; some hospitals mark a missed call as an immediate no-show instead.
 *
 * END_OF_QUEUE -> back of the checked-in pool, still callable today.
 * NO_REQUEUE   -> terminal NO_SHOW, refunded per cancellationRules.noShowRefundPct.
 *                 Deliberately the same terminal state as "booked and never arrived"
 *                 (PRD 8.9), so there is exactly one no-show refund path.
 */
export const RequeueBehavior = z.enum(['END_OF_QUEUE', 'NO_REQUEUE']);
export type RequeueBehavior = z.infer<typeof RequeueBehavior>;
