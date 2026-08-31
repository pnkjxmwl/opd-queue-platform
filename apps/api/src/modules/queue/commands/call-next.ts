import type { QueueCommandResult } from '@opd/contracts';
import { InvalidQueueTransitionError, NoEligiblePatientError } from '../../../common/errors';
import { nextEligibleEntry } from '../call-order';
import { nextEntryStatus, nextSessionStatus } from '../state-machine';
import type { QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * P4-BE-03 · `POST /sessions/:id/call-next` - the doctor asks for the next patient.
 *
 * **The server chooses.** The request carries no patient id, because a client that
 * named one would be deciding call order (docs/Rules.md 1). Who is next comes from
 * `call-order.ts` and nowhere else.
 *
 * Two concurrent calls cannot serve the same person: both serialise on the session
 * lock in `runCommand`, so the second reads the first's committed state and gets the
 * patient after them. That is the whole reason the lock exists.
 *
 * This is also what starts the session (`OPEN_FOR_REGISTRATION -> ACTIVE`). Phase 4
 * has no separate start-session command: calling the first patient IS the start.
 */
export function callNext(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'CALL_NEXT',
    handler: async (ctx) => {
      // Refuse to call anyone while someone is still with the doctor. Without this
      // a double-click produces two CALLED patients and two people walk in.
      const busy = await ctx.tx.queueEntry.findFirst({
        where: { sessionId, status: { in: ['CALLED', 'IN_CONSULTATION'] } },
        orderBy: { calledAt: 'asc' },
      });
      if (busy !== null) {
        throw new InvalidQueueTransitionError('CALL_NEXT', busy.status);
      }

      const entry = await nextEligibleEntry(ctx);
      if (entry === null) {
        // Distinct from an illegal transition: nothing is wrong, nobody has arrived.
        // The console says "nobody has checked in yet" rather than showing an error.
        throw new NoEligiblePatientError();
      }

      const status = nextEntryStatus('CALL_NEXT', entry.status);
      const updated = await ctx.tx.queueEntry.update({
        where: { id: entry.id },
        data: { status, calledAt: ctx.now },
        include: ENTRY_INCLUDE,
      });

      const sessionStatus = nextSessionStatus('CALL_NEXT', ctx.session.status);
      if (sessionStatus !== ctx.session.status) {
        ctx.patchSession({ status: sessionStatus });
        ctx.record({ type: 'SESSION_ACTIVATED', metadata: { from: 'OPEN_FOR_REGISTRATION' } });
      }

      ctx.record({
        type: 'ENTRY_CALLED',
        entryId: entry.id,
        metadata: {
          tokenLabel: entry.tokenLabel,
          priority: entry.priority,
          recallCount: entry.recallCount,
        },
      });

      return toCommandResult(ctx, updated);
    },
  });
}
