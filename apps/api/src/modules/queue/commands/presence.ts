import type { PresenceRequest, QueueCommandResult } from '@opd/contracts';
import type { QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

/**
 * P4-BE-05 · `POST /sessions/:id/presence` - where the doctor physically is.
 *
 * **Independent of session status** (docs/PRD.md 8.10), which is the whole point of
 * the field. A doctor arriving late does not change the session; a session running
 * does not mean anyone is in the room. Conflating the two makes "ACTIVE but nobody
 * present" unrepresentable - a state that happens every single day.
 *
 * Any presence may follow any other, so there is no transition table for it: a human
 * walking out of a room is a fact to record, not a move to validate. The only rule
 * is that the session must not be finished, which the state machine enforces.
 */
export function presence(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: PresenceRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'PRESENCE',
    handler: async (ctx) => {
      const from = ctx.session.doctorPresence;
      if (from !== input.presence) {
        ctx.patchSession({ doctorPresence: input.presence });
        ctx.record({
          type: 'DOCTOR_PRESENCE_CHANGED',
          metadata: { from, to: input.presence },
        });
      }
      return toCommandResult(ctx, null);
    },
  });
}
