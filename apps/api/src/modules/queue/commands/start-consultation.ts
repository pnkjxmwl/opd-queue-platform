import type { QueueCommandResult, StartConsultationRequest } from '@opd/contracts';
import { nextEntryStatus } from '../state-machine';
import type { QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * P4-BE-03 · `POST /sessions/:id/start-consultation` - the patient is in the room.
 *
 * `consultStartedAt` is the clock the ETA engine reads to know how long the current
 * patient has already taken (docs/Architecture.md 8), which is why it is stamped
 * here rather than inferred from `calledAt`: the gap between being called and
 * actually sitting down is walking time, not consultation time, and folding the two
 * together would inflate every doctor's average.
 */
export function startConsultation(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: StartConsultationRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'START_CONSULTATION',
    handler: async (ctx) => {
      const entry = await ctx.entryInSession(input.entryId);
      const status = nextEntryStatus('START_CONSULTATION', entry.status);

      const updated = await ctx.tx.queueEntry.update({
        where: { id: entry.id },
        data: { status, consultStartedAt: ctx.now },
        include: ENTRY_INCLUDE,
      });

      ctx.record({
        type: 'ENTRY_CONSULTATION_STARTED',
        entryId: entry.id,
        metadata: { tokenLabel: entry.tokenLabel },
      });

      return toCommandResult(ctx, updated);
    },
  });
}
