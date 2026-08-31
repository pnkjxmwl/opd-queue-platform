import type { QueueCommandResult, QueueEntryView } from '@opd/contracts';
import type { CommandContext, QueueEntryRow } from '../queue.service';

/**
 * The one place a command's response is shaped, so twelve commands cannot answer
 * the same question twelve slightly different ways.
 */

export const toEntryView = (entry: QueueEntryRow): QueueEntryView => ({
  id: entry.id,
  sessionId: entry.sessionId,
  patientId: entry.patientId,
  patientName: entry.patient.name,
  tokenNumber: entry.tokenNumber,
  tokenLabel: entry.tokenLabel,
  type: entry.type,
  priority: entry.priority,
  status: entry.status,
  recallCount: entry.recallCount,
  joinedAt: entry.joinedAt.toISOString(),
  checkedInAt: entry.checkedInAt?.toISOString() ?? null,
  calledAt: entry.calledAt?.toISOString() ?? null,
  consultStartedAt: entry.consultStartedAt?.toISOString() ?? null,
  completedAt: entry.completedAt?.toISOString() ?? null,
});

/**
 * `ctx.session` already carries whatever the command patched, so this reflects the
 * post-command state - except `version`, which is the value that was READ under the
 * lock. The row is written one higher, so the client is told the number it will see
 * on its next fetch rather than the one it is replacing.
 */
export const toCommandResult = (
  ctx: CommandContext,
  entry: QueueEntryRow | null,
): QueueCommandResult => ({
  sessionId: ctx.session.id,
  sessionStatus: ctx.session.status,
  doctorPresence: ctx.session.doctorPresence,
  pausedAt: ctx.session.pausedAt?.toISOString() ?? null,
  version: ctx.session.version + 1,
  entry: entry === null ? null : toEntryView(entry),
});
