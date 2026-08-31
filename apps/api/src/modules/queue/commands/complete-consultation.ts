import type { CompleteConsultationRequest, QueueCommandResult } from '@opd/contracts';
import { nextEntryStatus } from '../state-machine';
import type { QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/** A consultation shorter than this is a mis-click, not a visit. */
const MIN_DURATION_SEC = 1;

/**
 * P4-BE-03 · `POST /sessions/:id/complete-consultation` - the visit is over.
 *
 * Writes the `Consultation` row, which is the only place real durations are
 * recorded and therefore the entire input to the ETA engine's learning
 * (docs/Architecture.md 8). Everything the engine will ever know about how long this
 * doctor takes is created here.
 *
 * **Attributed to the current provider, not the booked doctor** (docs/PRD.md 8.11).
 * After a substitution, crediting the timings to the doctor who never showed up
 * would poison both doctors' averages - the absent one with work they did not do,
 * the substitute with none of the work they did.
 */
export function completeConsultation(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: CompleteConsultationRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'COMPLETE_CONSULTATION',
    handler: async (ctx) => {
      const entry = await ctx.entryInSession(input.entryId);
      const status = nextEntryStatus('COMPLETE_CONSULTATION', entry.status);

      // The state machine guarantees the entry is IN_CONSULTATION, which is only
      // reachable through start-consultation, so this timestamp is always set. The
      // fallback exists so a future transition into COMPLETED cannot produce a
      // Consultation row with a nonsense duration.
      const startedAt = entry.consultStartedAt ?? ctx.now;
      const durationSec = Math.max(
        MIN_DURATION_SEC,
        Math.round((ctx.now.getTime() - startedAt.getTime()) / 1000),
      );

      const updated = await ctx.tx.queueEntry.update({
        where: { id: entry.id },
        data: { status, completedAt: ctx.now },
        include: ENTRY_INCLUDE,
      });

      await ctx.tx.consultation.create({
        data: {
          hospitalId: ctx.session.hospitalId,
          queueEntryId: entry.id,
          patientId: entry.patientId,
          doctorId: ctx.session.currentProviderDoctorId,
          startedAt,
          endedAt: ctx.now,
          durationSec,
        },
      });

      ctx.record({
        type: 'ENTRY_CONSULTATION_COMPLETED',
        entryId: entry.id,
        metadata: { tokenLabel: entry.tokenLabel, durationSec },
      });

      return toCommandResult(ctx, updated);
    },
  });
}
