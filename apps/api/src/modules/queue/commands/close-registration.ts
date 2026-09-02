import type { QueueCommandResult } from '@opd/contracts';
import type { QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

/**
 * P8-BE-04 · `CLOSE_REGISTRATION` - the doors shut on new bookings.
 *
 * docs/PRD.md 8.12 names four ways registration ends. Three are computed on every
 * read by `common/registration.ts` and need no state: the session's status, the
 * clock against `cutoffMinsBeforeEnd`, and the token cap. This is the fourth - the
 * one that is a DECISION rather than a calculation, taken either by staff or by the
 * cutoff worker when the ETA says a new joiner would not be seen today.
 *
 * **It is a command, not a column update from a worker.** A timer that wrote
 * `registrationClosedAt` directly would skip the session lock, the audit log, the
 * timeline and the realtime broadcast - and docs/Phases.md calls that *"the single
 * most damaging shortcut available in this phase"*. Going through `runCommand` means
 * a patient's session card updates the instant it happens, and the audit trail says
 * who closed it and why.
 *
 * Idempotent by choice rather than by error: closing an already-closed session
 * changes nothing and reports the fact, because the worker will see the same session
 * on its next pass until the underlying read catches up, and that must not be an
 * error in a log nobody can act on.
 */
export function closeRegistration(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: { reason: string },
): Promise<QueueCommandResult & { alreadyClosed: boolean }> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'CLOSE_REGISTRATION',
    reason: input.reason,
    handler: async (ctx) => {
      if (ctx.session.registrationClosedAt !== null) {
        return { ...toCommandResult(ctx, null), alreadyClosed: true };
      }

      ctx.patchSession({ registrationClosedAt: ctx.now });
      ctx.record({
        type: 'SESSION_REGISTRATION_CLOSED',
        reason: input.reason,
        metadata: { closedAt: ctx.now.toISOString() },
      });

      return { ...toCommandResult(ctx, null), alreadyClosed: false };
    },
  });
}
