import { NotFoundError, RegistrationClosedError, AlreadyInQueueError } from '../../../common/errors';
import { registrationGate } from '../../../common/registration';
import { nextTokenNumber, tokenLabel } from '../call-order';
import { HOLDS_A_SLOT, JOIN_INITIAL_STATUS } from '../state-machine';
import type { CommandContext, QueueActor, QueueEntryRow, QueueService } from '../queue.service';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

export interface JoinOutcome {
  entry: QueueEntryRow;
  /** From the LOCKED session row. The only place the payable amount comes from. */
  feePaise: number;
  /**
   * True when this call found a hold the same patient already had, rather than
   * creating one. The caller re-uses the existing Razorpay order instead of opening
   * a second - which is what stops a retried request charging someone twice.
   */
  resumed: boolean;
}

/**
 * P5-BE-01 · `POST /sessions/:id/join` - a patient takes a place in the queue.
 *
 * Returns the reservation; it does NOT take money. Payment happens outside this
 * transaction, because a Razorpay call inside a transaction holding the session lock
 * would block every other command in the clinic on a third party's latency
 * (docs/Rules.md 4).
 *
 * **The token number is assigned here, not at payment.** That is a deliberate
 * divergence from docs/Architecture.md 10, recorded in docs/PROGRESS.md: reserving a
 * slot is precisely holding a number, `tokenNumber` is NOT NULL with
 * `unique(sessionId, tokenNumber)` behind it, and confirm-time assignment would need
 * that column nullable. The visible cost is a gap in the sequence when someone
 * abandons checkout, which is honest - docs/PRD.md 8.1 says the token is a label and
 * never a position.
 *
 * If the order or the Payment row that follows never gets written, this reservation
 * is simply an unpaid hold and lapses on its own. That failure mode is self-healing
 * by construction, which is why the entry is created first.
 */
export function joinQueue(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: { patientId: string; accountId: string; reservationTtlSec: number },
): Promise<JoinOutcome> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'JOIN',
    handler: async (ctx): Promise<JoinOutcome> => {
      await assertPatientBelongsToAccount(ctx, input.patientId, input.accountId);

      const existing = await findExistingEntry(ctx, input.patientId);
      if (existing !== null) {
        // Already paid for: opening a second booking would take money for a place
        // they already hold.
        if (existing.status !== 'RESERVED') {
          throw new AlreadyInQueueError(existing.id);
        }
        // A live unpaid hold. Not an error - this is the retry path, and the caller
        // resumes the same checkout. An EXPIRED hold falls through to a new
        // reservation, because its slot is already considered free.
        if (existing.reservationExpiresAt !== null && existing.reservationExpiresAt > ctx.now) {
          return { entry: existing, feePaise: ctx.session.feePaise, resumed: true };
        }
      }

      await assertRegistrationOpen(ctx);

      const tokenNumber = await nextTokenNumber(ctx);
      const entry = await ctx.tx.queueEntry.create({
        data: {
          hospitalId: ctx.session.hospitalId,
          sessionId,
          patientId: input.patientId,
          accountId: input.accountId,
          tokenNumber,
          tokenLabel: tokenLabel(ctx.session.tokenPrefix, tokenNumber),
          type: 'ONLINE',
          status: JOIN_INITIAL_STATUS,
          reservationExpiresAt: new Date(ctx.now.getTime() + input.reservationTtlSec * 1000),
        },
        include: ENTRY_INCLUDE,
      });

      ctx.record({
        type: 'ENTRY_RESERVED',
        entryId: entry.id,
        metadata: { tokenLabel: entry.tokenLabel, tokenNumber, feePaise: ctx.session.feePaise },
      });

      return { entry, feePaise: ctx.session.feePaise, resumed: false };
    },
  });
}

/**
 * The patient must be one of the caller's own profiles.
 *
 * `accountId` comes from the JWT, never the body. Without this check any signed-in
 * account could book on behalf of any patient id it could guess, which is both an
 * IDOR and a way to fill a stranger's queue (docs/Rules.md 1.3).
 */
async function assertPatientBelongsToAccount(
  ctx: CommandContext,
  patientId: string,
  accountId: string,
): Promise<void> {
  const patient = await ctx.tx.patient.findFirst({
    where: { id: patientId, accountId },
    select: { id: true },
  });
  if (patient === null) {
    // Same answer for "no such patient" and "not yours" - distinguishing them would
    // confirm which patient ids exist.
    throw new NotFoundError('Patient not found');
  }
}

/**
 * This patient's existing entry in this session, if any.
 *
 * Read under the session lock, which is what makes the read-then-create safe: two
 * simultaneous joins serialise on the session row, so the second sees the first's
 * committed reservation. That lock is why there is no separate idempotency key -
 * see docs/PROGRESS.md.
 *
 * CANCELLED entries are excluded: someone who cancelled may book again.
 */
async function findExistingEntry(
  ctx: CommandContext,
  patientId: string,
): Promise<QueueEntryRow | null> {
  return ctx.tx.queueEntry.findFirst({
    where: {
      sessionId: ctx.session.id,
      patientId,
      status: { in: [...HOLDS_A_SLOT] },
    },
    orderBy: { joinedAt: 'desc' },
    include: ENTRY_INCLUDE,
  });
}

/**
 * docs/PRD.md 8.12, enforced against the LOCKED row.
 *
 * The same gate discovery uses for the Join button, re-run here because the advisory
 * answer can go stale between the read and the write - the last slot can go to
 * somebody else while a patient is looking at the screen.
 */
async function assertRegistrationOpen(ctx: CommandContext): Promise<void> {
  const onlineTokensHeld = await ctx.tx.queueEntry.count({
    where: {
      sessionId: ctx.session.id,
      type: 'ONLINE',
      status: { in: [...HOLDS_A_SLOT] },
      // A lapsed hold is not holding anything, whether or not the sweeper has got
      // to it yet. The column is what frees the slot.
      NOT: { status: 'RESERVED', reservationExpiresAt: { lte: ctx.now } },
    },
  });

  const gate = registrationGate({
    status: ctx.session.status,
    registrationClosedAt: ctx.session.registrationClosedAt,
    scheduledEnd: ctx.session.scheduledEnd,
    policy: {
      cutoffMinsBeforeEnd: ctx.policy.cutoffMinsBeforeEnd,
      maxOnlineTokens: ctx.policy.maxOnlineTokens,
    },
    onlineTokensHeld,
    now: ctx.now,
  });

  if (!gate.open) {
    throw new RegistrationClosedError(gate.reason ?? 'SESSION_NOT_OPEN');
  }
}
