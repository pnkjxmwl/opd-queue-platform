import type { NoShowRequest, QueueCommandResult } from '@opd/contracts';
import { nextEntryStatus } from '../state-machine';
import type { QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * P4-BE-04 · `POST /sessions/:id/no-show` - the end of the absent road.
 *
 * Terminal. Reachable from SKIPPED (the normal path, once grace and every recall
 * attempt are spent) and directly from CALLED, for staff who already know the
 * patient has left the building.
 *
 * The same terminal state as "booked and never arrived" (docs/PRD.md 8.9) on
 * purpose, so there is exactly ONE no-show refund path for Phase 5 to implement
 * rather than two that will drift.
 */
export function noShow(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: NoShowRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'NO_SHOW',
    handler: async (ctx) => {
      const entry = await ctx.entryInSession(input.entryId);
      const status = nextEntryStatus('NO_SHOW', entry.status);

      const updated = await ctx.tx.queueEntry.update({
        where: { id: entry.id },
        data: { status },
        include: ENTRY_INCLUDE,
      });

      ctx.record({
        type: 'ENTRY_NO_SHOW',
        entryId: entry.id,
        metadata: { from: entry.status, tokenLabel: entry.tokenLabel, recallCount: entry.recallCount },
      });

      return toCommandResult(ctx, updated);
    },
  });
}
