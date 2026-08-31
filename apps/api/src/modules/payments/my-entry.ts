import type { Prisma } from '@prisma/client';
import type { CancellationRules, MyQueueEntry, QueueEntryStatus } from '@opd/contracts';
import { CALL_ORDER } from '../queue/call-order';
import { ELIGIBLE_TO_CALL, canApplyToEntry } from '../queue/state-machine';

/**
 * The patient's own visit, projected for docs/Design.md 5.6's token card.
 *
 * **Read-only, and deliberately not built from the console's `QueueEntryView`.** That
 * shape carries a patient name per row and belongs to staff; this one describes one
 * person and names nobody else (docs/Rules.md 8, DPDP). The counts differ too:
 * "ahead of YOU" is not "in this session", and only the first answers the question a
 * waiting patient is actually asking.
 *
 * This reads OPDSession, Hospital, Department and Doctor, which other modules own -
 * the same recorded exception to docs/CLAUDE.md 3 that `discovery` has, for the same
 * reason: it writes nothing, and routing a card's worth of joins through four
 * tenant-scoped services would reintroduce the per-card N+1 those services exist to
 * avoid.
 */

export const MY_ENTRY_INCLUDE = {
  patient: { select: { id: true, name: true } },
  payment: { select: { status: true } },
  session: {
    select: {
      id: true,
      status: true,
      scheduledStart: true,
      scheduledEnd: true,
      feePaise: true,
      hospital: { select: { id: true, name: true, area: true } },
      department: { select: { name: true } },
      currentProvider: { select: { name: true } },
    },
  },
} as const;

export type MyEntryRow = Prisma.QueueEntryGetPayload<{ include: typeof MY_ENTRY_INCLUDE }>;

/** The live numbers for one session, computed once and shared by every entry in it. */
export interface SessionLiveView {
  nowServingToken: string | null;
  /** Eligible entry ids in call order - an entry's position in this is its "ahead" count. */
  eligibleOrder: string[];
  bookedTokenNumbers: number[];
}

/**
 * Everything live about one session, in two queries.
 *
 * `eligibleOrder` is the real call order from `CALL_ORDER`, not a token sort: a
 * patient's "3 ahead of you" must be the same 3 the doctor will actually be handed,
 * or the number is a lie the moment anyone is escalated or requeued.
 *
 * ponytail: one round of these per session on the screen. A patient has one or two
 * active visits, so that is one or two rounds. If My Visits ever lists dozens at
 * once, batch by sessionId the way discovery's `snapshots()` does.
 */
export async function loadSessionLiveView(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<SessionLiveView> {
  const [eligible, serving, booked] = await Promise.all([
    tx.queueEntry.findMany({
      where: { sessionId, status: { in: [...ELIGIBLE_TO_CALL] } },
      orderBy: CALL_ORDER,
      select: { id: true },
    }),
    tx.queueEntry.findFirst({
      where: { sessionId, status: { in: ['CALLED', 'IN_CONSULTATION'] } },
      select: { tokenLabel: true },
    }),
    tx.queueEntry.findMany({
      where: { sessionId, status: { in: ['CONFIRMED', 'VIRTUAL_WAITING'] } },
      select: { tokenNumber: true },
    }),
  ]);

  return {
    nowServingToken: serving?.tokenLabel ?? null,
    eligibleOrder: eligible.map((e) => e.id),
    bookedTokenNumbers: booked.map((e) => e.tokenNumber),
  };
}

/**
 * How much of what they paid comes back if they cancel at `now`
 * (`QueuePolicy.cancellationRules`, docs/PRD.md 10).
 *
 * Exported because both the advisory field on the card and the actual refund must
 * come from this one function - a card that promises 100% and a cancel that pays 50%
 * is the kind of disagreement that ends up in a consumer complaint.
 */
export function refundPctIfCancelledAt(
  rules: CancellationRules,
  scheduledStart: Date,
  now: Date,
): number {
  const freeUntil = new Date(scheduledStart.getTime() - rules.freeCancellationMins * 60_000);
  return now <= freeUntil ? 100 : rules.lateCancellationRefundPct;
}

/**
 * Whether cancelling would be accepted right now.
 *
 * Asks the state machine rather than listing statuses again, so this can never drift
 * from what the command will actually allow (docs/Rules.md 9 - the client must not
 * reimplement queue logic, and neither must a projection).
 */
const isCancellable = (status: QueueEntryStatus): boolean =>
  status !== 'CANCELLED' && canApplyToEntry('CANCEL_ENTRY', status);

export function toMyQueueEntry(
  row: MyEntryRow,
  live: SessionLiveView,
  rules: CancellationRules,
  now: Date,
): MyQueueEntry {
  const position = live.eligibleOrder.indexOf(row.id);

  return {
    id: row.id,
    sessionId: row.sessionId,
    status: row.status,
    type: row.type,
    paymentStatus: row.payment?.status ?? null,

    tokenNumber: row.tokenNumber,
    tokenLabel: row.tokenLabel,
    checkInCode: row.checkInCode,

    patientId: row.patientId,
    patientName: row.patient.name,

    hospitalId: row.session.hospital.id,
    hospitalName: row.session.hospital.name,
    hospitalArea: row.session.hospital.area,
    departmentName: row.session.department.name,
    doctorName: row.session.currentProvider.name,

    scheduledStart: row.session.scheduledStart.toISOString(),
    scheduledEnd: row.session.scheduledEnd.toISOString(),
    feePaise: row.session.feePaise,

    reservationExpiresAt: row.reservationExpiresAt?.toISOString() ?? null,

    nowServingToken: live.nowServingToken,
    // In the eligible pool: whoever sorts before them. NOT in it - still at home, or
    // already done - everyone present is ahead, because docs/PRD.md 8.2 means an
    // absent patient is behind every present one no matter how early they booked.
    checkedInAheadCount: position === -1 ? live.eligibleOrder.length : position,
    bookedAheadCount: live.bookedTokenNumbers.filter((t) => t < row.tokenNumber).length,

    // Phase 7 fills these; a window, never a point.
    etaFrom: null,
    etaTo: null,

    joinedAt: row.joinedAt.toISOString(),
    checkedInAt: row.checkedInAt?.toISOString() ?? null,
    calledAt: row.calledAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,

    cancellable: isCancellable(row.status),
    refundPctIfCancelledNow: refundPctIfCancelledAt(rules, row.session.scheduledStart, now),
  };
}
