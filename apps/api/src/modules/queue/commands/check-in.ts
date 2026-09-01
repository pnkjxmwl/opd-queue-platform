import type { CheckInRequest, QueueCommandResult } from '@opd/contracts';
import { verifyCheckInCode } from '../../../common/checkin-code';
import { NotFoundError } from '../../../common/errors';
import { nextEntryStatus } from '../state-machine';
import type { CommandContext, QueueActor, QueueEntryRow, QueueService } from '../queue.service';
import { toCommandResult } from './result';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * P4-BE-03 · `POST /sessions/:id/check-in` - staff confirm a patient is here.
 *
 * Only checked-in patients are callable (docs/PRD.md 8.2), so this is the command
 * that lets the queue move at all.
 *
 * **Idempotent by design.** A second scan of the same QR code succeeds and changes
 * nothing - the state machine models `CHECKED_IN -> CHECKED_IN` as a legal no-op, and
 * `checkedInAt` is not overwritten. Reception double-scans constantly; a 409 there
 * would train staff to ignore errors.
 *
 * **A scanned code is verified before the database is touched** (P6-BE-01). The
 * signature check is a hash, so a camera pointed at a shampoo bottle costs nothing,
 * and nobody gets an oracle that says "that code was nearly right".
 */
export function checkIn(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: CheckInRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'CHECK_IN',
    handler: async (ctx) => {
      // Both lookups are scoped to THIS session. A token number is only unique
      // within a session, and a check-in code from a request body is
      // attacker-controlled (docs/Rules.md 1.3).
      const entry =
        input.checkInCode !== undefined
          ? await findByCode(ctx, sessionId, input.checkInCode)
          : await ctx.tx.queueEntry.findFirst({
              where: { sessionId, tokenNumber: input.tokenNumber },
              include: ENTRY_INCLUDE,
            });

      if (entry === null) {
        // Deliberately the same message for a bad code and a wrong session: a
        // distinguishable answer turns this into an oracle for guessing codes.
        throw new NotFoundError('No token matches that in this session');
      }

      const status = nextEntryStatus('CHECK_IN', entry.status);

      if (entry.status === status) {
        // Already here. Nothing to write, nothing to log - the arrival was recorded
        // the first time and re-stamping it would lose when they actually arrived.
        return toCommandResult(ctx, entry);
      }

      const updated = await ctx.tx.queueEntry.update({
        where: { id: entry.id },
        data: { status, checkedInAt: ctx.now },
        include: ENTRY_INCLUDE,
      });

      ctx.record({
        type: 'ENTRY_CHECKED_IN',
        entryId: entry.id,
        metadata: { from: entry.status, to: status, tokenLabel: entry.tokenLabel },
      });

      return toCommandResult(ctx, updated);
    },
  });
}

/**
 * Resolve a scanned QR payload to an entry in THIS session, or null.
 *
 * The signature is checked first and an unsigned or tampered payload never reaches
 * Postgres. Note what is deliberately absent: there is no fallback that tries the
 * raw string as a `checkInCode` when verification fails. That fallback is exactly how
 * a signing scheme becomes decoration - it would keep accepting the bare Phase-5
 * references, so anyone who ever saw one could still check in.
 */
async function findByCode(
  ctx: CommandContext,
  sessionId: string,
  payload: string,
): Promise<QueueEntryRow | null> {
  const reference = verifyCheckInCode(payload);
  if (reference === null) {
    return null;
  }
  return ctx.tx.queueEntry.findFirst({
    where: { sessionId, checkInCode: reference },
    include: ENTRY_INCLUDE,
  });
}
