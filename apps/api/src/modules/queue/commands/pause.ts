import type { PauseRequest, QueueCommandResult, ResumeRequest } from '@opd/contracts';
import type { QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

/**
 * P4-BE-05 · `POST /sessions/:id/pause` and `/resume` - the doctor steps away.
 *
 * Pausing blocks exactly one thing: handing the doctor another patient. Joins,
 * check-ins and walk-ins carry on, because people keep arriving at a reception desk
 * whether or not the doctor is in the room, and turning them away would be a worse
 * product than a slightly longer queue (docs/PRD.md 6.2). That rule is enforced in
 * the state machine, not here.
 *
 * The session stays ACTIVE throughout: a paused session has not ended, and its
 * patients are still today's patients.
 *
 * Both are idempotent - pausing a paused queue and resuming a running one both
 * succeed and change nothing. A doctor jabbing a button twice is not an error.
 */
export function pause(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: PauseRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'PAUSE',
    reason: input.reason ?? null,
    handler: async (ctx) => {
      if (ctx.session.pausedAt === null) {
        ctx.patchSession({ pausedAt: ctx.now });
        ctx.record({ type: 'SESSION_PAUSED', reason: input.reason ?? null });
      }
      return toCommandResult(ctx, null);
    },
  });
}

export function resume(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  _input: ResumeRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'RESUME',
    handler: async (ctx) => {
      if (ctx.session.pausedAt !== null) {
        const pausedForSec = Math.round((ctx.now.getTime() - ctx.session.pausedAt.getTime()) / 1000);
        ctx.patchSession({ pausedAt: null });
        ctx.record({ type: 'SESSION_RESUMED', metadata: { pausedForSec } });
      }
      return toCommandResult(ctx, null);
    },
  });
}
