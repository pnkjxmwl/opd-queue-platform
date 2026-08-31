import type { QueueCommandResult, SetPriorityRequest } from '@opd/contracts';
import { PolicyForbidsError } from '../../../common/errors';
import { TERMINAL_ENTRY_STATUSES } from '../state-machine';
import { InvalidQueueTransitionError } from '../../../common/errors';
import type { QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * P4-BE-06 · `POST /sessions/:id/priority` - an audited escalation.
 *
 * **Changes priority, never status.** That is what makes it safe: the entry stays
 * exactly where it is in its own lifecycle, and only its position in the computed
 * call order moves. Nobody else's row is touched - "everyone behind shifts"
 * (docs/PRD.md 8.7) is what the ORDER BY does, not something written to twelve rows,
 * which is why an emergency cannot corrupt the relative order of everyone else.
 *
 * The reason is required by the contract and is written to the `AuditLog`. It is
 * never shown to other patients: they see "the queue changed due to a priority case"
 * and nothing more (docs/Design.md 11, docs/PRD.md 8.7).
 *
 * Setting NORMAL undoes an escalation and is audited identically - an un-escalation
 * with no trail would be the easiest way to hide one.
 */
export function setPriority(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: SetPriorityRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'SET_PRIORITY',
    reason: input.reason,
    handler: async (ctx) => {
      if (!ctx.policy.priorityEnabled) {
        throw new PolicyForbidsError('priority and emergency insertions');
      }

      const entry = await ctx.entryInSession(input.entryId);

      // Escalating someone who has been seen, cancelled or written off changes
      // nothing about the queue and would leave a misleading audit trail suggesting
      // it did.
      if (TERMINAL_ENTRY_STATUSES.includes(entry.status)) {
        throw new InvalidQueueTransitionError('SET_PRIORITY', entry.status);
      }

      if (entry.priority === input.priority) {
        return toCommandResult(ctx, entry);
      }

      const updated = await ctx.tx.queueEntry.update({
        where: { id: entry.id },
        data: {
          priority: input.priority,
          // Stamped on every raise so two emergencies resolve in the order they were
          // escalated; cleared on the way back to NORMAL so a de-escalated entry
          // does not keep a tiebreak it is no longer entitled to.
          priorityAt: input.priority === 'NORMAL' ? null : ctx.now,
        },
        include: ENTRY_INCLUDE,
      });

      ctx.record({
        type: 'ENTRY_PRIORITY_CHANGED',
        entryId: entry.id,
        reason: input.reason,
        metadata: { from: entry.priority, to: input.priority, tokenLabel: entry.tokenLabel },
      });

      return toCommandResult(ctx, updated);
    },
  });
}
