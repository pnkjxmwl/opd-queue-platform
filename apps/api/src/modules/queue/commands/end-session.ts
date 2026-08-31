import type {
  EndSessionRequest,
  QueueCommandResult,
  QueueEntryStatus,
  QueueEventType,
} from '@opd/contracts';
import { InvalidQueueTransitionError } from '../../../common/errors';
import { TERMINAL_ENTRY_STATUSES, nextEntryStatus, nextSessionStatus } from '../state-machine';
import type { CommandContext, QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

/**
 * P4-BE-05 · `POST /sessions/:id/end` - the clinic is over.
 *
 * Resolves everyone still outstanding, and the split is the interesting part:
 *
 *   never arrived     -> NO_SHOW      (docs/PRD.md 8.9, refunded per policy)
 *   present, not seen -> RESCHEDULED  (docs/PRD.md 8.11, the doctor left early)
 *   never paid        -> CANCELLED    (a RESERVED hold was never a booking)
 *
 * docs/PRD.md 8.9 and docs/Phases.md P4-BE-05 look like they disagree about this and
 * do not - they describe different people. Someone who took the afternoon off, came
 * to the hospital and was not seen is not a no-show, and their refund must not be
 * decided as though they were. The mapping itself lives in the state machine's
 * END_SESSION table, so this command only walks it.
 *
 * **Refuses to end mid-consultation.** A patient sitting with the doctor is neither
 * "not seen" nor finished, and guessing would either fabricate a Consultation or
 * throw one away. Complete or skip them first; the rejection says so.
 */
export function endSession(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: EndSessionRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'END_SESSION',
    reason: input.reason ?? null,
    handler: async (ctx) => {
      const inConsultation = await ctx.tx.queueEntry.findFirst({
        where: { sessionId, status: 'IN_CONSULTATION' },
      });
      if (inConsultation !== null) {
        throw new InvalidQueueTransitionError('END_SESSION', 'IN_CONSULTATION');
      }

      await resolveOutstanding(ctx, sessionId);

      // Early = the doctor stopped before the session was scheduled to end. Patients
      // are told a different thing in each case (docs/PRD.md 8.11), so the two are
      // different statuses rather than one with a timestamp to interpret.
      const early = ctx.now < ctx.session.scheduledEnd;
      const status = nextSessionStatus('END_SESSION', ctx.session.status, { early });

      ctx.patchSession({ status, pausedAt: null });
      ctx.record({
        type: 'SESSION_ENDED',
        reason: input.reason ?? null,
        metadata: { status, early },
      });

      return toCommandResult(ctx, null);
    },
  });
}

/** How each end-of-session outcome is narrated on the timeline. */
const END_OF_SESSION_EVENT: Partial<Record<QueueEntryStatus, QueueEventType>> = {
  NO_SHOW: 'ENTRY_NO_SHOW',
  RESCHEDULED: 'ENTRY_RESCHEDULED',
};

/**
 * Walk every unfinished entry through the END_SESSION table.
 *
 * Grouped into one `updateMany` per target status rather than a write per entry: a
 * busy session has hundreds of entries and this runs while the session lock is held,
 * so the difference is between a transaction that closes promptly and one that holds
 * up every other console in the department.
 */
async function resolveOutstanding(ctx: CommandContext, sessionId: string): Promise<void> {
  const outstanding = await ctx.tx.queueEntry.findMany({
    // RESERVED is excluded, not forgotten. The state machine maps it to CANCELLED,
    // correctly - but nothing creates a RESERVED entry until Phase 5 introduces the
    // pre-payment hold, and cancelling one needs the ENTRY_CANCELLED event and the
    // refund path that arrive with it. Resolving reservations belongs to the phase
    // that can actually finish the job (docs/Rules.md 15.8).
    where: { sessionId, status: { notIn: [...TERMINAL_ENTRY_STATUSES, 'RESERVED'] } },
    select: { id: true, status: true, tokenLabel: true },
  });

  const byTarget = new Map<QueueEntryStatus, string[]>();
  for (const entry of outstanding) {
    const to = nextEntryStatus('END_SESSION', entry.status);
    const event = END_OF_SESSION_EVENT[to];
    if (event === undefined) {
      // Unreachable given the filter above; a loud skip rather than a plausible
      // wrong event if the table ever grows a target this command cannot narrate.
      continue;
    }

    const ids = byTarget.get(to);
    if (ids === undefined) {
      byTarget.set(to, [entry.id]);
    } else {
      ids.push(entry.id);
    }

    ctx.record({
      type: event,
      entryId: entry.id,
      metadata: { from: entry.status, to, tokenLabel: entry.tokenLabel, atSessionEnd: true },
    });
  }

  for (const [to, ids] of byTarget) {
    await ctx.tx.queueEntry.updateMany({ where: { id: { in: ids } }, data: { status: to } });
  }
}
