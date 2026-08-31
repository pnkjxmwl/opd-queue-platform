import { nextEntryStatus } from '../state-machine';
import type { CommandContext, QueueEntryRow } from '../queue.service';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * P5-BE-04 · withdraw from the queue.
 *
 * Like `applyPaymentConfirmation`, this is a STEP inside a command rather than a
 * whole one: the caller runs it inside its own `runCommand` so that the entry
 * transition and the `Refund` row it may raise commit together. A cancellation that
 * commits without its refund is a patient who lost both their place and their money.
 *
 * `EXPIRE_RESERVATION` and `CANCEL_ENTRY` are separate commands even though both
 * land on CANCELLED, because the audit trail must be able to answer "did they change
 * their mind, or did they never pay?" - and because the expiry table is narrowed to
 * RESERVED so the sweeper structurally cannot touch a paid entry.
 */
export async function applyCancellation(
  ctx: CommandContext,
  entryId: string,
  command: 'CANCEL_ENTRY' | 'EXPIRE_RESERVATION',
  reason: string | null,
): Promise<{ entry: QueueEntryRow; changed: boolean }> {
  const entry = await ctx.entryInSession(entryId);
  const status = nextEntryStatus(command, entry.status);

  if (entry.status === status) {
    // Already cancelled. A double-tap on Cancel, or a sweeper racing a patient who
    // just withdrew - neither is an error, and neither should write a second event.
    //
    // `changed` is what the caller MUST branch on before doing anything with money.
    // Returning only the row let the cancel path raise a second refund for a second
    // tap, because the no-op is invisible in the returned entry.
    return { entry, changed: false };
  }

  const updated = await ctx.tx.queueEntry.update({
    where: { id: entry.id },
    data: {
      status,
      // Nothing left to expire, and leaving a past timestamp here would make the
      // sweeper keep finding a row it can no longer act on.
      reservationExpiresAt: null,
    },
    include: ENTRY_INCLUDE,
  });

  ctx.record({
    type: 'ENTRY_CANCELLED',
    entryId: entry.id,
    reason,
    metadata: { from: entry.status, to: status, tokenLabel: entry.tokenLabel, via: command },
  });

  return { entry: updated, changed: true };
}
