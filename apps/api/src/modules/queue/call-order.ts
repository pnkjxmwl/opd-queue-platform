import type { Prisma } from '@prisma/client';
import { ELIGIBLE_TO_CALL } from './state-machine';
import type { CommandContext, QueueEntryRow } from './queue.service';

/**
 * Who the doctor gets next (P4-BE-06, docs/PRD.md 8.1-8.7).
 *
 * **The order is computed here, every time, and is never stored.** No column holds a
 * position and none ever should: an order written to a row is wrong the instant
 * anybody checks in, is skipped, or is escalated, and then two screens disagree
 * about who is next while a patient is standing at the door.
 *
 * Three rules, in this order:
 *
 *   1. **Only the present.** Eligibility is `ELIGIBLE_TO_CALL` from the state
 *      machine - nothing here re-decides it. This is docs/PRD.md 8.2: the doctor
 *      never idles waiting for someone who is still at home, no matter how early
 *      they booked.
 *   2. **Emergency, then priority, then everyone else** (docs/PRD.md 8.7), each
 *      audited with a reason. Within a level, whoever was escalated first.
 *   3. **Anyone requeued goes behind everyone who was not** (docs/PRD.md 8.8's
 *      "move to end"). This is the one rule that cannot fall out of the token
 *      number, because the token is immutable - so `requeuedAt` carries it.
 *   4. **Otherwise token order** - earliest booking first (docs/PRD.md 8.3). This is
 *      the fairness rule, and it is why a late check-in slots into its natural
 *      position (8.4) rather than going to the back: its token number never changed,
 *      so the moment it becomes eligible it sits exactly where it always belonged.
 */

/**
 * `priority` sorts by the enum's DECLARATION order in Postgres, which is
 * `NORMAL, PRIORITY, EMERGENCY` - so `desc` puts EMERGENCY first. If that enum is
 * ever reordered, this silently inverts; the scenario test is what would catch it.
 *
 * `priorityAt` is null for NORMAL entries, and every row within a level shares the
 * same nullness, so null ordering never decides anything.
 *
 * `requeuedAt` is the opposite: its NULLNESS is the whole point, and it must sort
 * FIRST, because null means "never sent to the back". Postgres puts nulls last on
 * ASC by default, which would invert the rule exactly - so `nulls: 'first'` is
 * load-bearing, not decoration.
 */
export const CALL_ORDER: Prisma.QueueEntryOrderByWithRelationInput[] = [
  { priority: 'desc' },
  { priorityAt: 'asc' },
  { requeuedAt: { sort: 'asc', nulls: 'first' } },
  { tokenNumber: 'asc' },
];

const ENTRY_INCLUDE = { patient: { select: { id: true, name: true } } } as const;

/** The next patient to call, or null when nobody present is waiting. */
export async function nextEligibleEntry(ctx: CommandContext): Promise<QueueEntryRow | null> {
  return ctx.tx.queueEntry.findFirst({
    where: { sessionId: ctx.session.id, status: { in: [...ELIGIBLE_TO_CALL] } },
    orderBy: CALL_ORDER,
    include: ENTRY_INCLUDE,
  });
}

/**
 * The whole eligible pool in call order. Used by the scenario tests and, later, by
 * the doctor console's "next up" strip.
 */
export async function eligibleQueue(ctx: CommandContext): Promise<QueueEntryRow[]> {
  return ctx.tx.queueEntry.findMany({
    where: { sessionId: ctx.session.id, status: { in: [...ELIGIBLE_TO_CALL] } },
    orderBy: CALL_ORDER,
    include: ENTRY_INCLUDE,
  });
}

/**
 * The next token number for this session.
 *
 * Read under the session lock, so the read-then-write is safe; the
 * `unique(sessionId, tokenNumber)` constraint is the second line of defence if a
 * future caller ever runs this outside the lock (docs/Rules.md 5).
 */
export async function nextTokenNumber(ctx: CommandContext): Promise<number> {
  const highest = await ctx.tx.queueEntry.aggregate({
    where: { sessionId: ctx.session.id },
    _max: { tokenNumber: true },
  });
  return (highest._max.tokenNumber ?? 0) + 1;
}

/** `tokenPrefix` + zero-padded number, e.g. "A027" (docs/Architecture.md 7.3). */
export const tokenLabel = (prefix: string, tokenNumber: number): string =>
  `${prefix}${String(tokenNumber).padStart(3, '0')}`;
