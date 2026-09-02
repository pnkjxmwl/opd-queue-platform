import type { DoctorPresence, QueueEntryStatus, SessionStatus } from '@opd/contracts';
import {
  DoctorHasLeftError,
  InvalidQueueTransitionError,
  QueuePausedError,
} from '../../common/errors';

/**
 * The queue state machine (docs/Rules.md 4, docs/Phases.md Phase 4 risks).
 *
 * **This file is the ONLY place a queue transition is decided.** Not "mostly" -
 * only. The moment transition logic appears as an `if` inside a command file, the
 * twelve commands stop agreeing with each other, illegal states reach production,
 * and nobody can answer "can this happen?" by reading one table.
 *
 * Everything here is PURE: plain values in, a value or a typed throw out. No Prisma,
 * no clock, no config. That is what lets every transition be tested exhaustively
 * without a database, and what stops "it depends on the row" creeping in.
 *
 * There are two machines, deliberately independent (docs/PRD.md 8.10):
 *   - the ENTRY machine - one patient's journey through a queue
 *   - the SESSION machine - the working block itself
 * plus doctor presence, which is not a machine at all: any presence may follow any
 * other, because a human walking out of a room is not a state transition to
 * validate. It is recorded, never rejected.
 */

/**
 * Every write the queue engine can perform. Internal to the engine on purpose - it
 * is not part of the API surface (clients address commands by URL), so it does not
 * belong in `packages/contracts`.
 *
 * The string values are what `AuditLog.action` records, so they must stay stable.
 */
export type QueueCommand =
  | 'JOIN'
  | 'CONFIRM_PAYMENT'
  | 'REINSTATE'
  | 'CANCEL_ENTRY'
  | 'EXPIRE_RESERVATION'
  | 'CHECK_IN'
  | 'CALL_NEXT'
  | 'START_CONSULTATION'
  | 'COMPLETE_CONSULTATION'
  | 'SKIP'
  | 'NO_SHOW'
  | 'REQUEUE'
  | 'WALK_IN'
  | 'SET_PRIORITY'
  | 'PAUSE'
  | 'RESUME'
  | 'END_SESSION'
  | 'PRESENCE'
  /** Phase 8: the registration-cutoff worker closing a session's doors. */
  | 'CLOSE_REGISTRATION';

export const QUEUE_COMMANDS: readonly QueueCommand[] = [
  'JOIN',
  'CONFIRM_PAYMENT',
  'REINSTATE',
  'CANCEL_ENTRY',
  'EXPIRE_RESERVATION',
  'CHECK_IN',
  'CALL_NEXT',
  'START_CONSULTATION',
  'COMPLETE_CONSULTATION',
  'SKIP',
  'NO_SHOW',
  'REQUEUE',
  'WALK_IN',
  'SET_PRIORITY',
  'PAUSE',
  'RESUME',
  'END_SESSION',
  'PRESENCE',
  'CLOSE_REGISTRATION',
];

export const ENTRY_STATUSES: readonly QueueEntryStatus[] = [
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
];

export const SESSION_STATUSES: readonly SessionStatus[] = [
  'SCHEDULED',
  'OPEN_FOR_REGISTRATION',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'ENDED_EARLY',
];

/**
 * A patient who is present and waiting to be seen.
 *
 * `READY` is here and unreachable in v1 exactly as docs/Architecture.md 7.1
 * specifies the predicate - see the note on `QueueEntryStatus` in
 * `packages/contracts/src/enums/queue.ts`. Membership of this set is the ONLY
 * definition of "callable": docs/PRD.md 8.2 says the doctor never idles for someone
 * still at home, and that rule lives here rather than in `call-next.ts` so no other
 * command can quietly disagree with it.
 */
export const ELIGIBLE_TO_CALL: readonly QueueEntryStatus[] = ['CHECKED_IN', 'READY'];

export const isEligibleToCall = (status: QueueEntryStatus): boolean =>
  ELIGIBLE_TO_CALL.includes(status);

/**
 * Statuses that consume one of the session's online token slots
 * (`QueuePolicy.maxOnlineTokens`, docs/PRD.md 8.12).
 *
 * Everything except CANCELLED, which is the deliberate rule: **a cancelled booking
 * and a lapsed unpaid hold free their slot, and nothing else does.** A no-show still
 * consumed a booking - the cap limits how many people the clinic accepted, not how
 * many turned up - and handing their place to someone else after the fact would
 * quietly overbook a session that had already closed.
 *
 * An expired RESERVED entry is still RESERVED until the sweeper writes to it, so the
 * caller pairs this with a `reservationExpiresAt > now` filter; the column, not a
 * job, is what frees the slot.
 */
export const HOLDS_A_SLOT: readonly QueueEntryStatus[] = [
  'RESERVED',
  'CONFIRMED',
  'VIRTUAL_WAITING',
  'CHECKED_IN',
  'READY',
  'CALLED',
  'IN_CONSULTATION',
  'COMPLETED',
  'NO_SHOW',
  'SKIPPED',
  'RESCHEDULED',
];

/** Nothing further can happen to an entry in one of these. */
export const TERMINAL_ENTRY_STATUSES: readonly QueueEntryStatus[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
  'RESCHEDULED',
];

// ---------------------------------------------------------------------------
// The entry table
// ---------------------------------------------------------------------------

/**
 * `from -> to` per command. **A missing key is an illegal transition** - that is the
 * whole safety property, so never add a catch-all.
 *
 * A value equal to its key is a legal NO-OP, which is how idempotency is expressed:
 * staff double-scan a QR code and that must succeed rather than 409.
 */
const ENTRY_TRANSITIONS: Record<
  QueueCommand,
  Partial<Record<QueueEntryStatus, QueueEntryStatus>>
> = {
  /**
   * Creates the entry, so it has no `from` - same shape as WALK_IN below. A join is
   * born RESERVED (see JOIN_INITIAL_STATUS): the slot is held, nothing is paid for,
   * and nobody may be called from it.
   */
  JOIN: {},

  /**
   * The signature-verified webhook, and the ONLY thing that turns a hold into a
   * booking (docs/Rules.md 1.4). CONFIRMED -> CONFIRMED is the duplicate-webhook
   * no-op: Razorpay retries, and a replay must be silent rather than a 409 that
   * turns one successful payment into a retry storm.
   */
  CONFIRM_PAYMENT: {
    RESERVED: 'CONFIRMED',
    CONFIRMED: 'CONFIRMED',
  },

  /**
   * A payment captured for a hold that had already lapsed.
   *
   * Deliberately its own command rather than another row in CONFIRM_PAYMENT, even
   * though the destination is the same. This is the one transition in the product
   * that leaves a TERMINAL state, so it is named, audited under its own action, and
   * impossible to reach by accident - a manually cancelled entry cannot be
   * resurrected by a stray webhook just because the status happens to match.
   *
   * The rule it implements: the webhook wins. The money moved and the token number
   * was never handed to anyone else, so giving the slot back is a status change.
   * When there is no queue left to rejoin - the session is over - the session
   * machine below refuses this and the caller refunds instead.
   */
  REINSTATE: {
    CANCELLED: 'CONFIRMED',
  },

  /**
   * The patient withdraws (docs/PRD.md 6.1). Allowed right up to being CALLED and
   * no further: once the doctor is waiting, the honest records are skip and no-show,
   * not a cancellation.
   *
   * CHECKED_IN is included even though they are standing in the building - people
   * get called away, and forcing that to become a NO_SHOW would put a false fact in
   * the data to save one table row. What it costs them is decided by
   * QueuePolicy.cancellationRules, not by this table.
   */
  CANCEL_ENTRY: {
    RESERVED: 'CANCELLED',
    CONFIRMED: 'CANCELLED',
    VIRTUAL_WAITING: 'CANCELLED',
    CHECKED_IN: 'CANCELLED',
    READY: 'CANCELLED',
    CANCELLED: 'CANCELLED',
  },

  /**
   * An unpaid hold ran out. Only ever from RESERVED - anything already paid for is
   * untouchable by the sweeper, which is the property docs/Rules.md 9 asks for
   * ("releasing a slot must not affect a paid entry") and the one this narrow row
   * makes structurally true rather than a matter of the caller's `where` clause.
   */
  EXPIRE_RESERVATION: {
    RESERVED: 'CANCELLED',
  },

  /**
   * docs/PRD.md 8.4 - a late check-in simply becomes eligible; it does NOT get a new
   * token and does not go to the back. Its position among the checked-in pool falls
   * out of its original token number, computed at call time.
   */
  CHECK_IN: {
    CONFIRMED: 'CHECKED_IN',
    VIRTUAL_WAITING: 'CHECKED_IN',
    CHECKED_IN: 'CHECKED_IN',
  },

  CALL_NEXT: {
    CHECKED_IN: 'CALLED',
    READY: 'CALLED',
  },

  START_CONSULTATION: {
    CALLED: 'IN_CONSULTATION',
  },

  COMPLETE_CONSULTATION: {
    IN_CONSULTATION: 'COMPLETED',
  },

  /** docs/PRD.md 8.8 - called and absent: passed over, still today's patient. */
  SKIP: {
    CALLED: 'SKIPPED',
  },

  /**
   * The terminal end of the same road: grace and every recall attempt are spent.
   * Reachable from SKIPPED (the normal path) and directly from CALLED (staff who
   * already know the patient has left).
   */
  NO_SHOW: {
    CALLED: 'NO_SHOW',
    SKIPPED: 'NO_SHOW',
  },

  /** Back into the eligible pool. Where they land is call-order's problem, not this table's. */
  REQUEUE: {
    SKIPPED: 'CHECKED_IN',
  },

  /**
   * Creates an entry rather than moving one, so it has no `from`. Listed with an
   * empty map so the table stays exhaustive over QueueCommand and a future reader
   * cannot mistake the omission for an oversight. Walk-ins are born CHECKED_IN
   * (docs/PRD.md 8.6) - see WALK_IN_INITIAL_STATUS.
   */
  WALK_IN: {},

  /** Escalation changes priority, never status - which is exactly why it is safe. */
  SET_PRIORITY: {},

  PAUSE: {},
  RESUME: {},
  PRESENCE: {},

  /** Touches the SESSION, never an entry - the doors close, the queue does not move. */
  CLOSE_REGISTRATION: {},

  /**
   * docs/PRD.md 8.9 and 8.11 read like they disagree about end-of-session, and do
   * not: they describe different people.
   *
   *   never arrived      -> NO_SHOW      (8.9; refunded per policy)
   *   present, not seen  -> RESCHEDULED  (8.11; the doctor left early, not their fault)
   *   never paid         -> CANCELLED    (a RESERVED hold is not a booking)
   *
   * Someone who showed up and was not seen is not a no-show, and the refund follows
   * from that distinction. Terminal states map to themselves: ending a session must
   * not resurrect a completed visit.
   */
  END_SESSION: {
    RESERVED: 'CANCELLED',
    CONFIRMED: 'NO_SHOW',
    VIRTUAL_WAITING: 'NO_SHOW',
    CHECKED_IN: 'RESCHEDULED',
    READY: 'RESCHEDULED',
    CALLED: 'RESCHEDULED',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    NO_SHOW: 'NO_SHOW',
    RESCHEDULED: 'RESCHEDULED',
  },
};

/** docs/PRD.md 8.6 - a walk-in is physically present by definition. */
export const WALK_IN_INITIAL_STATUS: QueueEntryStatus = 'CHECKED_IN';

/**
 * docs/PRD.md 10 - joining holds a slot; paying is what books it.
 *
 * A RESERVED entry is deliberately NOT in ELIGIBLE_TO_CALL, so an unpaid hold can
 * never be handed to a doctor no matter how the queue is sorted.
 */
export const JOIN_INITIAL_STATUS: QueueEntryStatus = 'RESERVED';

/**
 * The legal next status, or a typed rejection.
 *
 * Returning the same status is a legal no-op; callers should compare and skip the
 * write rather than treating it as an error.
 */
export function nextEntryStatus(
  command: QueueCommand,
  from: QueueEntryStatus,
): QueueEntryStatus {
  const to = ENTRY_TRANSITIONS[command][from];
  if (to === undefined) {
    throw new InvalidQueueTransitionError(command, from);
  }
  return to;
}

/** Non-throwing form, for callers deciding whether to offer an action at all. */
export function canApplyToEntry(command: QueueCommand, from: QueueEntryStatus): boolean {
  return ENTRY_TRANSITIONS[command][from] !== undefined;
}

// ---------------------------------------------------------------------------
// The session table
// ---------------------------------------------------------------------------

/**
 * Which session statuses accept each command.
 *
 * `SCHEDULED` accepts almost nothing: a session that has not opened for
 * registration has no queue to operate on. `PRESENCE` is the exception, because
 * doctor presence is independent of session status (docs/PRD.md 8.10) - a doctor
 * can be in the room before the session opens, and recording that is not a queue
 * mutation.
 *
 * `COMPLETED`, `CANCELLED` and `ENDED_EARLY` accept nothing at all. A finished
 * session is history.
 */
const SESSION_ACCEPTS: Record<QueueCommand, readonly SessionStatus[]> = {
  // A running clinic still takes bookings and still takes payment for them
  // (docs/PRD.md 8.12 closes registration on its own limits, never on ACTIVE).
  JOIN: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  CONFIRM_PAYMENT: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  // Refused once the session is over, which is what routes a too-late payment to a
  // refund instead of into a queue that no longer exists.
  REINSTATE: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  CANCEL_ENTRY: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  EXPIRE_RESERVATION: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  CHECK_IN: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  CALL_NEXT: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  START_CONSULTATION: ['ACTIVE'],
  COMPLETE_CONSULTATION: ['ACTIVE'],
  SKIP: ['ACTIVE'],
  NO_SHOW: ['ACTIVE'],
  REQUEUE: ['ACTIVE'],
  WALK_IN: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  SET_PRIORITY: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  PAUSE: ['ACTIVE'],
  RESUME: ['ACTIVE'],
  END_SESSION: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  PRESENCE: ['SCHEDULED', 'OPEN_FOR_REGISTRATION', 'ACTIVE'],
  // Only a session that is actually open can be closed. Re-closing a closed one is
  // refused by the command itself rather than here, because the SESSION status does
  // not change - `registrationClosedAt` does.
  CLOSE_REGISTRATION: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
};

/**
 * Commands a paused queue refuses.
 *
 * Only the one that hands the doctor a new patient. Pausing must NOT stop the
 * session accepting joins, check-ins or walk-ins: people keep arriving at a
 * reception desk while the doctor is on a break, and turning them away would be a
 * worse product than a slightly longer queue (docs/PRD.md 6.2).
 */
const BLOCKED_WHILE_PAUSED: readonly QueueCommand[] = ['CALL_NEXT'];

/**
 * Commands refused once the doctor is marked LEFT.
 *
 * Presence is still not a state machine - any presence may follow any other, and
 * nothing here rejects a presence CHANGE. This is a guard on one command, the same
 * shape as the pause rule above.
 *
 * LEFT is the only presence that blocks anything. NOT_PRESENT and ON_BREAK must
 * not: a doctor who is late or momentarily out is the ordinary case
 * (docs/PRD.md 8.11, "doctor late -> session/queue unaffected"), and reception
 * routinely calls the next patient in as the doctor walks back to the room.
 * LEFT means gone for the day, which docs/PRD.md 8.11 says should end the session -
 * so calling more patients into an empty room is staff having forgotten a step, not
 * a workflow to support.
 */
const BLOCKED_WHEN_DOCTOR_LEFT: readonly QueueCommand[] = ['CALL_NEXT'];

/**
 * Gate a command against the session it targets. Throws, or returns cleanly.
 *
 * Takes a plain object rather than a Prisma row so it stays pure and testable.
 */
export function assertSessionAccepts(
  command: QueueCommand,
  session: { status: SessionStatus; pausedAt: Date | null; doctorPresence: DoctorPresence },
): void {
  if (!SESSION_ACCEPTS[command].includes(session.status)) {
    throw new InvalidQueueTransitionError(command, session.status);
  }
  if (session.pausedAt !== null && BLOCKED_WHILE_PAUSED.includes(command)) {
    throw new QueuePausedError();
  }
  if (session.doctorPresence === 'LEFT' && BLOCKED_WHEN_DOCTOR_LEFT.includes(command)) {
    throw new DoctorHasLeftError();
  }
}

/**
 * The session status after a command, which for almost every command is the status
 * it already had.
 *
 * Two commands move it:
 *
 * `CALL_NEXT` is what makes a session ACTIVE. Phase 4 has no start-session command
 * (docs/Phases.md Phase 4 endpoint list), and the doctor calling the first patient
 * IS the session starting - inventing a separate command would add a button whose
 * only job is to be forgotten.
 *
 * `END_SESSION` distinguishes a session that ran its course from one cut short,
 * because docs/PRD.md 8.11 treats "doctor leaves early" as a different event that
 * patients are notified about. `early` is passed in rather than read from a clock
 * here, so this function stays pure.
 */
export function nextSessionStatus(
  command: QueueCommand,
  from: SessionStatus,
  opts: { early?: boolean } = {},
): SessionStatus {
  // Status-only question: the pause and presence guards are the caller's concern
  // and have already run against the real row by the time this is reached.
  assertSessionAccepts(command, { status: from, pausedAt: null, doctorPresence: 'PRESENT' });

  if (command === 'CALL_NEXT') {
    return 'ACTIVE';
  }
  if (command === 'END_SESSION') {
    return opts.early === true ? 'ENDED_EARLY' : 'COMPLETED';
  }
  return from;
}
