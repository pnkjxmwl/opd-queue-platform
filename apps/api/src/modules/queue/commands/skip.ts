import type { QueueCommandResult, SkipRequest } from '@opd/contracts';
import { nextEntryStatus } from '../state-machine';
import type { QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * P4-BE-04 · `POST /sessions/:id/skip` - called, did not appear, move on.
 *
 * The first step of docs/PRD.md 8.8's road: grace -> recall -> SKIPPED -> requeue.
 * Skipping is NOT a no-show: the patient is still today's patient and can be
 * requeued the moment they turn up. Only `no-show` ends it.
 *
 * `recallCount` increments here, and is compared against `QueuePolicy.recallAttempts`
 * by whoever decides to give up - the staff console today, the grace-expiry worker
 * in Phase 8. **The threshold is never hardcoded in this file**; the policy owns it,
 * which is the whole reason it is a per-hospital column.
 */
export function skip(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: SkipRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'SKIP',
    reason: input.reason ?? null,
    handler: async (ctx) => {
      const entry = await ctx.entryInSession(input.entryId);
      const status = nextEntryStatus('SKIP', entry.status);

      const updated = await ctx.tx.queueEntry.update({
        where: { id: entry.id },
        data: { status, recallCount: { increment: 1 } },
        include: ENTRY_INCLUDE,
      });

      ctx.record({
        type: 'ENTRY_SKIPPED',
        entryId: entry.id,
        reason: input.reason ?? null,
        metadata: { tokenLabel: entry.tokenLabel, recallCount: updated.recallCount },
      });

      return toCommandResult(ctx, updated);
    },
  });
}
