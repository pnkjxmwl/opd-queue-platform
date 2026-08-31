import type { CheckInRequest, QueueCommandResult } from '@opd/contracts';
import { NotFoundError } from '../../../common/errors';
import { nextEntryStatus } from '../state-machine';
import type { QueueActor, QueueService } from '../queue.service';
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
      const entry = await ctx.tx.queueEntry.findFirst({
        where: {
          sessionId,
          ...(input.checkInCode !== undefined
            ? { checkInCode: input.checkInCode }
            : { tokenNumber: input.tokenNumber }),
        },
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
