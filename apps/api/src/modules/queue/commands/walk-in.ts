import type { QueueCommandResult, WalkInRequest } from '@opd/contracts';
import { NotFoundError, PolicyForbidsError } from '../../../common/errors';
import { nextTokenNumber, tokenLabel } from '../call-order';
import { WALK_IN_INITIAL_STATUS } from '../state-machine';
import type { CommandContext, QueueActor, QueueService } from '../queue.service';
import { toCommandResult } from './result';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * P4-BE-06 · `POST /sessions/:id/walk-in` - someone turned up at reception.
 *
 * **Auto-checked-in and appended at the next token number** (docs/PRD.md 8.6). There
 * is no way to place a walk-in anywhere else, and that is deliberate: an
 * arbitrary-placement API is a queue-jumping API, and the audited `priority` command
 * already exists for the cases that genuinely justify it.
 *
 * They are born `CHECKED_IN` because a walk-in is physically present by definition,
 * so they are immediately callable - and they sit behind everyone already waiting,
 * because their token is the highest.
 *
 * The token number is read and written under the session lock, and
 * `unique(sessionId, tokenNumber)` backs it up in the database: two receptionists
 * registering walk-ins at the same instant is precisely the race an application
 * check loses (docs/Rules.md 5).
 */
export function walkIn(
  queue: QueueService,
  sessionId: string,
  actor: QueueActor,
  input: WalkInRequest,
): Promise<QueueCommandResult> {
  return queue.runCommand({
    sessionId,
    actor,
    command: 'WALK_IN',
    handler: async (ctx) => {
      if (!ctx.policy.walkInEnabled) {
        throw new PolicyForbidsError('walk-in registration');
      }

      const patientId = await resolvePatient(ctx, input);
      const tokenNumber = await nextTokenNumber(ctx);

      const entry = await ctx.tx.queueEntry.create({
        data: {
          hospitalId: ctx.session.hospitalId,
          sessionId,
          patientId,
          // No account: a walk-in registered at a desk has no app login, which is
          // why Patient.accountId is nullable (see the Phase-4 migration).
          accountId: null,
          tokenNumber,
          tokenLabel: tokenLabel(ctx.session.tokenPrefix, tokenNumber),
          type: 'WALK_IN',
          status: WALK_IN_INITIAL_STATUS,
          checkedInAt: ctx.now,
        },
        include: ENTRY_INCLUDE,
      });

      ctx.record({
        type: 'WALK_IN_ADDED',
        entryId: entry.id,
        metadata: { tokenLabel: entry.tokenLabel, tokenNumber },
      });

      return toCommandResult(ctx, entry);
    },
  });
}

/**
 * Reuse the patient reception found, or create one owned by nobody.
 *
 * An existing `patientId` is verified to exist but is NOT restricted to this
 * hospital: `Patient` is global by design (docs/Architecture.md 5.2) - the same
 * person visits several hospitals - and a hospital only ever sees them through a
 * QueueEntry in its own session, which is what this command is creating.
 */
async function resolvePatient(ctx: CommandContext, input: WalkInRequest): Promise<string> {
  if (input.patientId !== undefined) {
    const existing = await ctx.tx.patient.findUnique({
      where: { id: input.patientId },
      select: { id: true },
    });
    if (existing === null) {
      throw new NotFoundError('Patient not found');
    }
    return existing.id;
  }

  const created = await ctx.tx.patient.create({
    data: {
      accountId: null,
      // The refine on WalkInRequest guarantees a name when there is no patientId.
      name: input.name as string,
      dob: input.dob === undefined ? null : new Date(input.dob),
      gender: input.gender ?? null,
      relation: 'SELF',
    },
    select: { id: true },
  });
  return created.id;
}
