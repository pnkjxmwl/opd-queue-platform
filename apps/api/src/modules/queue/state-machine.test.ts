import { describe, expect, it } from 'vitest';
import type { QueueEntryStatus, SessionStatus } from '@opd/contracts';
import {
  ELIGIBLE_TO_CALL,
  ENTRY_STATUSES,
  JOIN_INITIAL_STATUS,
  QUEUE_COMMANDS,
  SESSION_STATUSES,
  WALK_IN_INITIAL_STATUS,
  assertSessionAccepts,
  canApplyToEntry,
  isEligibleToCall,
  nextEntryStatus,
  nextSessionStatus,
  type QueueCommand,
} from './state-machine';
import {
  DoctorHasLeftError,
  InvalidQueueTransitionError,
  QueuePausedError,
} from '../../common/errors';

/**
 * P4-BE-01 done-when: "every legal transition ok, illegal rejected".
 *
 * The test carries its OWN copy of the transition table and asserts the machine
 * agrees with it exactly - both directions. That duplication is the entire point:
 * a test that derives its expectations from the table under test would pass no
 * matter what the table said. Widening the machine by one entry fails here, which
 * is what makes the table a safety property rather than documentation.
 */

type Triple = [QueueCommand, QueueEntryStatus, QueueEntryStatus];

/** Every legal entry transition in the product, written out independently. */
const EXPECTED_LEGAL: Triple[] = [
  // Join and pay (Phase 5). A hold becomes a booking only via the verified webhook.
  ['CONFIRM_PAYMENT', 'RESERVED', 'CONFIRMED'],
  // Razorpay retries; a replayed webhook must be a silent no-op, not a 409.
  ['CONFIRM_PAYMENT', 'CONFIRMED', 'CONFIRMED'],
  // The one transition in the product that leaves a terminal state, on purpose:
  // a payment captured for a hold that had just lapsed. See REINSTATE.
  ['REINSTATE', 'CANCELLED', 'CONFIRMED'],

  // Withdrawing. Allowed up to CALLED and no further.
  ['CANCEL_ENTRY', 'RESERVED', 'CANCELLED'],
  ['CANCEL_ENTRY', 'CONFIRMED', 'CANCELLED'],
  ['CANCEL_ENTRY', 'VIRTUAL_WAITING', 'CANCELLED'],
  ['CANCEL_ENTRY', 'CHECKED_IN', 'CANCELLED'],
  ['CANCEL_ENTRY', 'READY', 'CANCELLED'],
  // Idempotent: a double-tap on Cancel must not be an error.
  ['CANCEL_ENTRY', 'CANCELLED', 'CANCELLED'],

  // The sweeper. RESERVED and nothing else - a paid entry is untouchable.
  ['EXPIRE_RESERVATION', 'RESERVED', 'CANCELLED'],

  // Arrival. docs/PRD.md 8.4 - a late check-in becomes eligible, it does not
  // re-token and does not go to the back.
  ['CHECK_IN', 'CONFIRMED', 'CHECKED_IN'],
  ['CHECK_IN', 'VIRTUAL_WAITING', 'CHECKED_IN'],
  // Idempotent: staff double-scan a QR code and that must not be a 409.
  ['CHECK_IN', 'CHECKED_IN', 'CHECKED_IN'],

  // The consultation road.
  ['CALL_NEXT', 'CHECKED_IN', 'CALLED'],
  ['CALL_NEXT', 'READY', 'CALLED'],
  ['START_CONSULTATION', 'CALLED', 'IN_CONSULTATION'],
  ['COMPLETE_CONSULTATION', 'IN_CONSULTATION', 'COMPLETED'],

  // The absent road. docs/PRD.md 8.8.
  ['SKIP', 'CALLED', 'SKIPPED'],
  ['NO_SHOW', 'CALLED', 'NO_SHOW'],
  ['NO_SHOW', 'SKIPPED', 'NO_SHOW'],
  ['REQUEUE', 'SKIPPED', 'CHECKED_IN'],

  // End of session. docs/PRD.md 8.9 (never arrived) vs 8.11 (present, not seen).
  ['END_SESSION', 'RESERVED', 'CANCELLED'],
  ['END_SESSION', 'CONFIRMED', 'NO_SHOW'],
  ['END_SESSION', 'VIRTUAL_WAITING', 'NO_SHOW'],
  ['END_SESSION', 'CHECKED_IN', 'RESCHEDULED'],
  ['END_SESSION', 'READY', 'RESCHEDULED'],
  ['END_SESSION', 'CALLED', 'RESCHEDULED'],
  ['END_SESSION', 'COMPLETED', 'COMPLETED'],
  ['END_SESSION', 'CANCELLED', 'CANCELLED'],
  ['END_SESSION', 'NO_SHOW', 'NO_SHOW'],
  ['END_SESSION', 'RESCHEDULED', 'RESCHEDULED'],
];

const key = (command: QueueCommand, from: QueueEntryStatus) => `${command}:${from}`;
const expectedByKey = new Map(EXPECTED_LEGAL.map((t) => [key(t[0], t[1]), t[2]]));

describe('entry state machine (P4-BE-01)', () => {
  it('allows exactly the transitions the product defines, and no others', () => {
    const unexpected: string[] = [];

    for (const command of QUEUE_COMMANDS) {
      for (const from of ENTRY_STATUSES) {
        const expected = expectedByKey.get(key(command, from));

        if (expected === undefined) {
          if (canApplyToEntry(command, from)) {
            unexpected.push(`${key(command, from)} is allowed but should not be`);
          }
          expect(() => nextEntryStatus(command, from)).toThrow(InvalidQueueTransitionError);
        } else {
          expect(nextEntryStatus(command, from), key(command, from)).toBe(expected);
        }
      }
    }

    expect(unexpected).toEqual([]);
  });

  it('covers every command and every status, so a new one cannot slip through untested', () => {
    expect(QUEUE_COMMANDS).toHaveLength(19);
    expect(ENTRY_STATUSES).toHaveLength(12);
    // 19 x 12 pairs considered; only these are legal. CLOSE_REGISTRATION (Phase 8)
    // adds none: it shuts the session's doors and moves nobody.
    expect(EXPECTED_LEGAL).toHaveLength(31);
  });

  it('walks the PRD 7.3 happy path end to end', () => {
    let status: QueueEntryStatus = 'CONFIRMED';
    status = nextEntryStatus('CHECK_IN', status);
    expect(status).toBe('CHECKED_IN');
    status = nextEntryStatus('CALL_NEXT', status);
    expect(status).toBe('CALLED');
    status = nextEntryStatus('START_CONSULTATION', status);
    expect(status).toBe('IN_CONSULTATION');
    status = nextEntryStatus('COMPLETE_CONSULTATION', status);
    expect(status).toBe('COMPLETED');
  });

  it('walks the no-show road: called -> skipped -> requeued -> called again', () => {
    let status = nextEntryStatus('SKIP', 'CALLED');
    expect(status).toBe('SKIPPED');
    status = nextEntryStatus('REQUEUE', status);
    expect(status).toBe('CHECKED_IN');
    status = nextEntryStatus('CALL_NEXT', status);
    expect(status).toBe('CALLED');
    // ...and if they are still absent, the road ends.
    expect(nextEntryStatus('NO_SHOW', nextEntryStatus('SKIP', status))).toBe('NO_SHOW');
  });

  it('never lets a patient who is still at home be called', () => {
    // The single most important rejection in the product (docs/PRD.md 8.2).
    for (const athome of ['RESERVED', 'CONFIRMED', 'VIRTUAL_WAITING'] as QueueEntryStatus[]) {
      expect(() => nextEntryStatus('CALL_NEXT', athome)).toThrow(InvalidQueueTransitionError);
    }
  });

  it('never lets an entry jump the consultation states', () => {
    expect(() => nextEntryStatus('COMPLETE_CONSULTATION', 'CHECKED_IN')).toThrow();
    expect(() => nextEntryStatus('COMPLETE_CONSULTATION', 'CALLED')).toThrow();
    expect(() => nextEntryStatus('START_CONSULTATION', 'CHECKED_IN')).toThrow();
  });

  it('leaves terminal entries alone, with exactly two named exceptions', () => {
    // Phase 5 weakened this property, and the exceptions are written out here rather
    // than the loop being loosened - so a THIRD way to touch a terminal entry fails
    // this test instead of quietly joining the family.
    const terminal: QueueEntryStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'];
    for (const from of terminal) {
      for (const command of QUEUE_COMMANDS) {
        if (command === 'END_SESSION') {
          // Maps to itself: ending a session must not resurrect a finished visit.
          expect(nextEntryStatus(command, from)).toBe(from);
        } else if (command === 'REINSTATE' && from === 'CANCELLED') {
          // The webhook wins: a payment captured for a hold that had just lapsed.
          expect(nextEntryStatus(command, from)).toBe('CONFIRMED');
        } else if (command === 'CANCEL_ENTRY' && from === 'CANCELLED') {
          // Idempotency, not resurrection - it stays exactly where it was.
          expect(nextEntryStatus(command, from)).toBe('CANCELLED');
        } else {
          expect(() => nextEntryStatus(command, from), key(command, from)).toThrow(
            InvalidQueueTransitionError,
          );
        }
      }
    }
  });

  it('can never resurrect anything except a cancellation', () => {
    // REINSTATE is the only door out of a terminal state, and CANCELLED is the only
    // room it opens. A no-show or a completed visit is finished, full stop.
    for (const from of ['COMPLETED', 'NO_SHOW', 'RESCHEDULED'] as QueueEntryStatus[]) {
      expect(() => nextEntryStatus('REINSTATE', from)).toThrow(InvalidQueueTransitionError);
    }
  });

  it('never lets the sweeper touch an entry that was paid for', () => {
    // docs/Rules.md 9: "releasing a slot must not affect a paid entry". RESERVED is
    // the only status that has not been paid for, so it is the only one here.
    for (const from of ENTRY_STATUSES) {
      if (from === 'RESERVED') continue;
      expect(() => nextEntryStatus('EXPIRE_RESERVATION', from), from).toThrow(
        InvalidQueueTransitionError,
      );
    }
  });

  it('reports a rejection the console can explain itself with', () => {
    try {
      nextEntryStatus('CALL_NEXT', 'COMPLETED');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidQueueTransitionError);
      const e = error as InvalidQueueTransitionError;
      expect(e.code).toBe('INVALID_QUEUE_TRANSITION');
      expect(e.httpStatus).toBe(409);
      expect(e.details).toEqual({ command: 'CALL_NEXT', from: 'COMPLETED' });
    }
  });

  it('defines eligibility in one place, and a walk-in starts inside it', () => {
    expect([...ELIGIBLE_TO_CALL]).toEqual(['CHECKED_IN', 'READY']);
    expect(isEligibleToCall('CHECKED_IN')).toBe(true);
    expect(isEligibleToCall('VIRTUAL_WAITING')).toBe(false);
    expect(isEligibleToCall('CALLED')).toBe(false);
    // docs/PRD.md 8.6 - a walk-in is present by definition, so it is callable at once.
    expect(isEligibleToCall(WALK_IN_INITIAL_STATUS)).toBe(true);
    // ...and an unpaid hold is not callable however the queue is sorted (PRD 10).
    expect(isEligibleToCall(JOIN_INITIAL_STATUS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

/** Which session statuses accept each command - again written out independently. */
const EXPECTED_SESSION_ACCEPTS: Record<QueueCommand, SessionStatus[]> = {
  JOIN: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
  CONFIRM_PAYMENT: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
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
  // Phase 8. Only a session that is open can have its doors closed; re-closing a
  // closed one is the command's own no-op, not a session-status question.
  CLOSE_REGISTRATION: ['OPEN_FOR_REGISTRATION', 'ACTIVE'],
};

const running = (status: SessionStatus) => ({
  status,
  pausedAt: null,
  doctorPresence: 'PRESENT' as const,
});

describe('session state machine (P4-BE-01)', () => {
  it('accepts exactly the session statuses each command allows', () => {
    for (const command of QUEUE_COMMANDS) {
      for (const status of SESSION_STATUSES) {
        const allowed = EXPECTED_SESSION_ACCEPTS[command].includes(status);
        if (allowed) {
          expect(() => assertSessionAccepts(command, running(status))).not.toThrow();
        } else {
          expect(() => assertSessionAccepts(command, running(status)), `${command}/${status}`).toThrow(
            InvalidQueueTransitionError,
          );
        }
      }
    }
  });

  it('treats a finished session as history - nothing at all is accepted', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'ENDED_EARLY'] as SessionStatus[]) {
      for (const command of QUEUE_COMMANDS) {
        expect(() => assertSessionAccepts(command, running(status))).toThrow();
      }
    }
  });

  it('records doctor presence before the session opens, because presence is independent', () => {
    // docs/PRD.md 8.10 - a doctor in the room at 09:45 is a fact, not a queue mutation.
    expect(() => assertSessionAccepts('PRESENCE', running('SCHEDULED'))).not.toThrow();
    expect(() => assertSessionAccepts('CALL_NEXT', running('SCHEDULED'))).toThrow();
  });

  it('pauses only the command that hands the doctor a patient', () => {
    const paused = { status: 'ACTIVE' as SessionStatus, pausedAt: new Date() };
    expect(() => assertSessionAccepts('CALL_NEXT', paused)).toThrow(QueuePausedError);
    // People keep arriving at reception while the doctor is on a break.
    expect(() => assertSessionAccepts('CHECK_IN', paused)).not.toThrow();
    expect(() => assertSessionAccepts('WALK_IN', paused)).not.toThrow();
    expect(() => assertSessionAccepts('RESUME', paused)).not.toThrow();
    expect(() => assertSessionAccepts('END_SESSION', paused)).not.toThrow();
  });

  it('refuses to call another patient once the doctor is marked LEFT', () => {
    const left = { status: 'ACTIVE' as SessionStatus, pausedAt: null, doctorPresence: 'LEFT' as const };
    expect(() => assertSessionAccepts('CALL_NEXT', left)).toThrow(DoctorHasLeftError);

    // Ending the session is exactly what should happen instead (docs/PRD.md 8.11),
    // so it must still be allowed - as must marking the doctor present again.
    expect(() => assertSessionAccepts('END_SESSION', left)).not.toThrow();
    expect(() => assertSessionAccepts('PRESENCE', left)).not.toThrow();
    // And the desk keeps working: people are still arriving.
    expect(() => assertSessionAccepts('CHECK_IN', left)).not.toThrow();
    expect(() => assertSessionAccepts('WALK_IN', left)).not.toThrow();
    // A patient already in the room is still finished properly.
    expect(() => assertSessionAccepts('COMPLETE_CONSULTATION', left)).not.toThrow();
  });

  it('does not let a LATE doctor block the queue', () => {
    // docs/PRD.md 11 - a late doctor leaves the session and queue unaffected, and
    // reception calls the next patient in as the doctor walks back to the room.
    //
    // NOT_PRESENT is also the DEFAULT for every session, so blocking on it would
    // make marking the doctor present a mandatory ceremony before the first patient
    // of every clinic - and the first call-next is what activates a session at all.
    const late = { status: 'ACTIVE', pausedAt: null, doctorPresence: 'NOT_PRESENT' } as const;
    expect(() => assertSessionAccepts('CALL_NEXT', late)).not.toThrow();
    expect(() => assertSessionAccepts('START_CONSULTATION', late)).not.toThrow();
  });

  it('refuses to call a patient in while the doctor is ON A BREAK', () => {
    // Phase 8. A tester marked a doctor on break and watched reception keep calling
    // patients in and starting consultations. ON_BREAK is not NOT_PRESENT: somebody
    // positively declared the doctor away, and a control that says so while the
    // queue carries on regardless is a button that does nothing.
    const onBreak = { status: 'ACTIVE', pausedAt: null, doctorPresence: 'ON_BREAK' } as const;

    expect(() => assertSessionAccepts('CALL_NEXT', onBreak)).toThrow(/on a break/i);
    // A consultation cannot BEGIN with a doctor who is not in the room - and letting
    // it would feed a fiction to the ETA engine, which learns from those durations.
    expect(() => assertSessionAccepts('START_CONSULTATION', onBreak)).toThrow(/on a break/i);
  });

  it('keeps the desk working while the doctor is away, in both away states', () => {
    for (const doctorPresence of ['ON_BREAK', 'LEFT'] as const) {
      const away = { status: 'ACTIVE', pausedAt: null, doctorPresence } as const;

      // Patients keep arriving at a reception desk whatever a dropdown says.
      expect(() => assertSessionAccepts('CHECK_IN', away)).not.toThrow();
      expect(() => assertSessionAccepts('WALK_IN', away)).not.toThrow();

      // And a consultation already under way must ALWAYS be closable. Blocking this
      // would strand a patient IN_CONSULTATION for good the moment anyone touched
      // presence mid-visit, with no way back out.
      expect(() => assertSessionAccepts('COMPLETE_CONSULTATION', away)).not.toThrow();

      // Fixing the situation must never be blocked by the situation.
      expect(() => assertSessionAccepts('PRESENCE', away)).not.toThrow();
      expect(() => assertSessionAccepts('END_SESSION', away)).not.toThrow();
    }
  });

  it('tells a receptionist WHICH kind of absence they are looking at', () => {
    // The remedy differs: a break is waited out, a departure ends the session. One
    // shared error would leave the desk guessing.
    const base = { status: 'ACTIVE', pausedAt: null } as const;
    expect(() =>
      assertSessionAccepts('CALL_NEXT', { ...base, doctorPresence: 'ON_BREAK' }),
    ).toThrow(/break/i);
    expect(() =>
      assertSessionAccepts('CALL_NEXT', { ...base, doctorPresence: 'LEFT' }),
    ).toThrow(/left/i);
  });

  it('makes the session ACTIVE when the doctor calls the first patient', () => {
    // Phase 4 has no start-session command: calling the first patient IS the start.
    expect(nextSessionStatus('CALL_NEXT', 'OPEN_FOR_REGISTRATION')).toBe('ACTIVE');
    expect(nextSessionStatus('CALL_NEXT', 'ACTIVE')).toBe('ACTIVE');
  });

  it('distinguishes a session that ran its course from one cut short', () => {
    expect(nextSessionStatus('END_SESSION', 'ACTIVE')).toBe('COMPLETED');
    expect(nextSessionStatus('END_SESSION', 'ACTIVE', { early: true })).toBe('ENDED_EARLY');
  });

  it('leaves the session status alone for every other command', () => {
    for (const command of QUEUE_COMMANDS) {
      if (command === 'CALL_NEXT' || command === 'END_SESSION') continue;
      for (const status of EXPECTED_SESSION_ACCEPTS[command]) {
        expect(nextSessionStatus(command, status), `${command}/${status}`).toBe(status);
      }
    }
  });
});
