import type { QueueCommandResult, RequeueRequest } from '@opd/contracts';
import { PolicyForbidsError } from '../../../common/errors';
import { nextEntryStatus } from '../state-machine';
import type { QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * P4-BE-04 · `POST /sessions/:id/requeue` - a skipped patient is back.
 *
 * Returns them to the eligible pool **at the back of it** (docs/PRD.md 8.8,
 * `RequeueBehavior.END_OF_QUEUE`), by stamping `requeuedAt`. The token number is
 * immutable and the call order is computed, so that column is the only thing that
 * can express "moved to the end" - and it has to, because ordering a returning
 * patient by their original token would hand an early token straight back to the
 * doctor as the next patient, which is the loop the grace period exists to stop.
 *
 * `QueuePolicy.requeueBehavior` is honoured here: NO_REQUEUE hospitals treat a
 * missed call as final, so the command is refused rather than quietly ignored.
 */
export function requeue(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: RequeueRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'REQUEUE',
    handler: async (ctx) => {
      if (ctx.policy.requeueBehavior === 'NO_REQUEUE') {
        throw new PolicyForbidsError('requeueing a missed patient');
      }

      const entry = await ctx.entryInSession(input.entryId);
      const status = nextEntryStatus('REQUEUE', entry.status);

      const updated = await ctx.tx.queueEntry.update({
        where: { id: entry.id },
        data: { status, calledAt: null, requeuedAt: ctx.now },
        include: ENTRY_INCLUDE,
      });

      ctx.record({
        type: 'ENTRY_REQUEUED',
        entryId: entry.id,
        metadata: {
          tokenLabel: entry.tokenLabel,
          recallCount: entry.recallCount,
          movedToEndOfQueue: true,
        },
      });

      return toCommandResult(ctx, updated);
    },
  });
}
