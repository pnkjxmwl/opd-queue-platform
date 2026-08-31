import { z } from 'zod';

/**
 * Queue entry lifecycle. See docs/PRD.md 7.3 and docs/Architecture.md 5.1.
 *
 * Happy path:
 *   CONFIRMED -> VIRTUAL_WAITING -> CHECKED_IN -> CALLED
 *             -> IN_CONSULTATION -> COMPLETED
 *
 * RESERVED is the pre-payment hold (Phase 5). The terminal/alternate states are
 * CANCELLED, NO_SHOW, SKIPPED and RESCHEDULED.
 *
 * **READY is reserved and unreachable in v1.** docs/PRD.md 7.3 lists it between
 * CHECKED_IN and CALLED, but nothing in the product distinguishes the two: CALLED
 * already means "your turn, come in", so a separate "eligible and next" state would
 * have to be recomputed on every queue change - which is precisely the stored call
 * order that docs/Phases.md forbids. No Phase-4 command writes it. It stays in the
 * enum because the eligibility predicate accepts {CHECKED_IN, READY} exactly as
 * docs/Architecture.md 7.1 specifies, so a later phase can give it a meaning without
 * touching call-order logic - and because removing a value from a shipped contract
 * is the one change that breaks an installed app.
 *
 * The legal transitions between these live in the Phase-4 state machine, NOT here.
 * This enum only names the states.
 */
export const QueueEntryStatus = z.enum([
  'RESERVED',
  'CONFIRMED',
  'VIRTUAL_WAITING',
  'CHECKED_IN',
  'READY',
  'CALLED',
  'IN_CONSULTATION',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'SKIPPED',
  'RESCHEDULED',
]);

export type QueueEntryStatus = z.infer<typeof QueueEntryStatus>;

/**
 * How an entry got into the queue. **Provenance, and immutable once set.**
 *
 * docs/PRD.md 8.5 lists PRIORITY and EMERGENCY alongside these, as one enum. This
 * build splits them out into `QueueEntryPriority` instead, because escalation is a
 * thing that HAPPENS TO an entry rather than a kind of entry: folding it into this
 * field means an escalated walk-in stops being recorded as a walk-in, which silently
 * corrupts the walk-in-vs-online volumes in docs/PRD.md 6.4 reporting and loses the
 * fact that an ONLINE entry has a payment behind it (Phase 5 refunds).
 *
 * It is the same shape the schema already uses for substitution - `originalDoctorId`
 * kept beside `currentProviderDoctorId` (docs/PRD.md 8.11) - applied to the same
 * class of problem: never overwrite the fact of how something started.
 */
export const QueueEntryType = z.enum(['ONLINE', 'WALK_IN', 'FOLLOW_UP']);
export type QueueEntryType = z.infer<typeof QueueEntryType>;

/**
 * Audited escalation (docs/PRD.md 8.7). Set only by the `priority` command, which
 * requires a reason and writes an AuditLog.
 *
 * Ordering among the eligible pool is `EMERGENCY, then PRIORITY, then NORMAL`, and
 * within a level by `priorityAt` then `tokenNumber` - so two emergencies resolve in
 * the order they were escalated, and everyone else stays in booking order
 * (docs/PRD.md 8.3). The order is COMPUTED from these fields on every read; it is
 * never stored (docs/Phases.md Phase 4 risks).
 */
export const QueueEntryPriority = z.enum(['NORMAL', 'PRIORITY', 'EMERGENCY']);
export type QueueEntryPriority = z.infer<typeof QueueEntryPriority>;

/**
 * Who performed an action, for `QueueEvent` and `AuditLog`.
 *
 * SYSTEM is a background job with no human behind it (grace expiry, reservation
 * expiry) and is the only value for which the actor id is null.
 */
export const ActorType = z.enum(['PATIENT', 'STAFF', 'DOCTOR', 'SYSTEM']);
export type ActorType = z.infer<typeof ActorType>;

/**
 * The append-only queue timeline (docs/Architecture.md 5.1, docs/Rules.md 5). One
 * value per thing that can happen to a queue, not one per endpoint - `SKIPPED` is
 * the same event whether a human or the grace-expiry job caused it, and `actorType`
 * is what tells them apart.
 *
 * Phase 5 added the join/payment events (`ENTRY_RESERVED`, `ENTRY_CONFIRMED`,
 * `ENTRY_CANCELLED`) as an additive `ALTER TYPE ... ADD VALUE`, which was cheap
 * exactly as predicted.
 *
 * **There is no `ENTRY_RESERVATION_EXPIRED`, on purpose.** An expired hold IS a
 * cancellation - the same thing happening to the same entry - and `actorType` is
 * what says whether a person or the sweeper caused it, precisely as it already does
 * for a skip. A second value would mean every reader had to learn that two events
 * mean one thing.
 */
export const QueueEventType = z.enum([
  'ENTRY_RESERVED',
  'ENTRY_CONFIRMED',
  'ENTRY_CANCELLED',
  'ENTRY_CHECKED_IN',
  'ENTRY_CALLED',
  'ENTRY_RECALLED',
  'ENTRY_CONSULTATION_STARTED',
  'ENTRY_CONSULTATION_COMPLETED',
  'ENTRY_SKIPPED',
  'ENTRY_NO_SHOW',
  'ENTRY_REQUEUED',
  'ENTRY_PRIORITY_CHANGED',
  'ENTRY_RESCHEDULED',
  'WALK_IN_ADDED',
  'SESSION_ACTIVATED',
  'SESSION_PAUSED',
  'SESSION_RESUMED',
  'SESSION_ENDED',
  'DOCTOR_PRESENCE_CHANGED',
]);
export type QueueEventType = z.infer<typeof QueueEventType>;
