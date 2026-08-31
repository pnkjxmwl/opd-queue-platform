import { randomBytes } from 'node:crypto';
import { nextEntryStatus } from '../state-machine';
import type { CommandContext, QueueEntryRow } from '../queue.service';

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/**
 * The check-in reference printed as a QR on the token card.
 *
 * Opaque and non-enumerable (docs/Rules.md 10): 24 random bytes, so it carries no
 * PII, is not derived from the entry id, and cannot be walked. **Phase 6 replaces
 * this with a SIGNED payload** so a tampered code is rejected without a database
 * lookup; until then the code's only property is that it is unguessable, which is
 * enough for the `unique` lookup `check-in` already does.
 *
 * base64url so it survives a URL, a QR encoder and a receptionist reading it aloud.
 */
const newCheckInCode = (): string => randomBytes(24).toString('base64url');

/**
 * P5-BE-02 · turn a paid hold into a booking.
 *
 * **Not a whole command - a step inside one.** The payments module runs this within
 * its own `runCommand`, so the entry transition and the `Payment` row commit
 * together or not at all. Anything else has a failure mode where the patient has
 * paid and has no token, or has a token we have no record of paying for.
 *
 * The queue module keeps ownership of the entry write (docs/CLAUDE.md 3); the
 * payments module writes only `Payment`, through the same `ctx.tx`.
 *
 * `command` is chosen by the caller from the entry's current status:
 *   - `CONFIRM_PAYMENT` - the ordinary path, RESERVED -> CONFIRMED, and the
 *     idempotent CONFIRMED -> CONFIRMED that a replayed webhook takes.
 *   - `REINSTATE` - the hold had already lapsed and the money arrived anyway. Its
 *     own command so the audit trail says which of the two happened.
 *
 * If the status changes between that choice and this write, the state machine
 * rejects it and the webhook is answered non-2xx, so Razorpay retries and the next
 * attempt sees the settled state. A retry is the right outcome there; guessing is
 * not.
 */
export async function applyPaymentConfirmation(
  ctx: CommandContext,
  entryId: string,
  command: 'CONFIRM_PAYMENT' | 'REINSTATE',
): Promise<QueueEntryRow> {
  const entry = await ctx.entryInSession(entryId);
  const status = nextEntryStatus(command, entry.status);

  if (entry.status === status && entry.checkInCode !== null) {
    // A duplicate webhook. Already confirmed, already has its code: write nothing,
    // record nothing. Re-stamping would move the join time and mint a second code,
    // invalidating the QR the patient is already holding on screen.
    return entry;
  }

  const updated = await ctx.tx.queueEntry.update({
    where: { id: entry.id },
    data: {
      status,
      // Issued once and never rotated - the patient may already have screenshotted it.
      checkInCode: entry.checkInCode ?? newCheckInCode(),
      // The hold is over; it either became a booking or it never expires again.
      reservationExpiresAt: null,
    },
    include: ENTRY_INCLUDE,
  });

  ctx.record({
    type: 'ENTRY_CONFIRMED',
    entryId: entry.id,
    metadata: { from: entry.status, to: status, tokenLabel: entry.tokenLabel, via: command },
  });

  return updated;
}
