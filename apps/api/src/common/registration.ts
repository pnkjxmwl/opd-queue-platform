import type { SessionStatus } from '@opd/contracts';

/**
 * Whether a session accepts a new online booking (docs/PRD.md 8.12).
 *
 * **One function, two callers, on purpose.** `discovery` calls it to decide whether
 * the Join button is live; the `JOIN` command calls it to decide whether to accept
 * the booking. If those two ever disagreed, a patient would tap a button the server
 * then refuses - or worse, the button would be greyed out on a session that would
 * happily have taken them. It lives in `common/` rather than in either module
 * because it is pure: values in, an answer out, no Prisma and no clock of its own.
 *
 * The advisory read is still only advisory (docs/Rules.md 1). The answer can change
 * between the read and the write, and the write is the one that counts - which is
 * exactly why the write re-runs this under the session lock.
 *
 * docs/PRD.md 8.12 names four mechanisms. Three are implemented here; the fourth,
 * `cutoffOnEtaOverrun`, needs a predicted finish time and therefore an ETA engine,
 * which does not exist until Phase 7. **It is not silently ignored** - see
 * `etaOverrun` below, which Phase 7 fills in with one line and no new call sites.
 */

export type RegistrationClosedReason =
  | 'SESSION_NOT_OPEN'
  | 'SESSION_ENDED'
  | 'MANUALLY_CLOSED'
  | 'PAST_CUTOFF'
  | 'TOKEN_CAP_REACHED';

export interface RegistrationGateInput {
  status: SessionStatus;
  registrationClosedAt: Date | null;
  scheduledEnd: Date;
  policy: {
    cutoffMinsBeforeEnd: number | null;
    maxOnlineTokens: number | null;
  };
  /**
   * Online bookings currently holding a place. A cancelled booking and a lapsed
   * unpaid hold free their slot; nothing else does - see `HOLDS_A_SLOT`.
   */
  onlineTokensHeld: number;
  /**
   * Phase 7: true when a patient joining now would not be seen before the session
   * ends. Always false until then, so this term is inert rather than wrong.
   */
  etaOverrun?: boolean;
  now: Date;
}

export interface RegistrationGateResult {
  open: boolean;
  reason: RegistrationClosedReason | null;
}

/**
 * A running clinic still takes bookings. ACTIVE is in this set deliberately: the
 * first `call-next` activates a session, and closing registration the moment the
 * doctor sees their first patient would shut every clinic as it opened its doors.
 */
const ACCEPTS_BOOKINGS: readonly SessionStatus[] = ['OPEN_FOR_REGISTRATION', 'ACTIVE'];

export function registrationGate(input: RegistrationGateInput): RegistrationGateResult {
  const closed = (reason: RegistrationClosedReason): RegistrationGateResult => ({
    open: false,
    reason,
  });

  if (!ACCEPTS_BOOKINGS.includes(input.status)) {
    return closed('SESSION_NOT_OPEN');
  }
  if (input.registrationClosedAt !== null) {
    return closed('MANUALLY_CLOSED');
  }
  if (input.scheduledEnd <= input.now) {
    return closed('SESSION_ENDED');
  }

  // "Stop taking bookings N minutes before the doctor is due to finish", so the last
  // person through the door has a realistic chance of being seen.
  const cutoffMins = input.policy.cutoffMinsBeforeEnd;
  if (cutoffMins !== null) {
    const cutoffAt = new Date(input.scheduledEnd.getTime() - cutoffMins * 60_000);
    if (input.now >= cutoffAt) {
      return closed('PAST_CUTOFF');
    }
  }

  const cap = input.policy.maxOnlineTokens;
  if (cap !== null && input.onlineTokensHeld >= cap) {
    return closed('TOKEN_CAP_REACHED');
  }

  if (input.etaOverrun === true) {
    return closed('PAST_CUTOFF');
  }

  return { open: true, reason: null };
}
