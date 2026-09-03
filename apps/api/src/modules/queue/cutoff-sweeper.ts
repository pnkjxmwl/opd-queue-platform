import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Sweeper } from '../../common/sweeper';
import { QueuePolicyService } from '../config/queue-policy.service';
import { EtaService } from '../eta/eta.service';
import { QueueService, type QueueActor } from './queue.service';
import { closeRegistration } from './commands/close-registration';
import { ELIGIBLE_TO_CALL } from './state-machine';

/**
 * P8-BE-04 · stop taking bookings the clinic cannot honour (docs/PRD.md 8.12).
 *
 * This is the `cutoffOnEtaOverrun` mechanism, and it is the one that needed the ETA
 * engine before it could exist. `common/registration.ts` has carried the hook since
 * Phase 3, inert and honest about it:
 *
 * > *Phase 7: true when a patient joining now would not be seen before the session
 * > ends. Always false until then, so this term is inert rather than wrong.*
 *
 * Now it is true when it is true. A patient who joins at 12:50 for a clinic that
 * ends at 13:00 with eleven people waiting is going to be sent home unseen, having
 * paid - and the honest thing is to close the doors before taking their money rather
 * than to refund them afterwards.
 *
 * **A sweep rather than a check at join time**, because the two do different jobs:
 * the join-time gate stops the next booking, and this closes the session so every
 * patient BROWSING it sees "closed" rather than a Join button that will refuse them.
 */

/** ETAs move on the scale of a consultation; a minute is ample. */
const INTERVAL_MS = 60_000;
const MAX_PER_SWEEP = 30;

@Injectable()
export class CutoffSweeper extends Sweeper {
  protected readonly name = 'cutoff';
  protected readonly intervalMs = INTERVAL_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly policies: QueuePolicyService,
    private readonly eta: EtaService,
  ) {
    super();
  }

  protected async sweep(): Promise<void> {
    await this.closeOverrunSessions();
  }

  /** Public so a test runs one deterministic pass. Returns the sessions it closed. */
  async closeOverrunSessions(now: Date = new Date()): Promise<string[]> {
    const open = await this.prisma.oPDSession.findMany({
      where: {
        status: { in: ['OPEN_FOR_REGISTRATION', 'ACTIVE'] },
        registrationClosedAt: null,
        // A session that has already finished for the day needs no cutoff; ending it
        // is END_SESSION's job and it has closed the doors by definition.
        scheduledEnd: { gt: now },
      },
      select: {
        id: true,
        hospitalId: true,
        currentProviderDoctorId: true,
        scheduledEnd: true,
      },
      take: MAX_PER_SWEEP,
    });
    if (open.length === 0) return [];

    // Only hospitals that asked for this. It is a per-hospital policy switch, and a
    // clinic that would rather keep taking bookings and stay late is entitled to.
    const wanted: typeof open = [];
    for (const session of open) {
      const policy = await this.policies.ensure(session.hospitalId);
      if (policy.cutoffOnEtaOverrun) wanted.push(session);
    }
    if (wanted.length === 0) return [];

    const waiting = await this.prisma.queueEntry.groupBy({
      by: ['sessionId'],
      where: {
        sessionId: { in: wanted.map((s) => s.id) },
        status: { in: [...ELIGIBLE_TO_CALL] },
      },
      _count: { _all: true },
    });
    const aheadBySession = new Map(waiting.map((row) => [row.sessionId, row._count._all]));

    const windows = await this.eta.windowsFor(
      wanted.map((session) => ({
        key: session.id,
        sessionId: session.id,
        doctorId: session.currentProviderDoctorId,
        aheadCount: aheadBySession.get(session.id) ?? 0,
        // Not needed for a join-now estimate at this resolution: whoever is in the
        // room is already counted by the queue in front of a newcomer.
        currentStartedAt: null,
        estimable: true,
      })),
      now,
    );

    const closed: string[] = [];
    for (const session of wanted) {
      const window = windows.get(session.id);
      if (window === null || window === undefined) continue;

      // The EARLY edge of the window, not the late one. Closing the doors is a
      // decision against the patient, so it should need the optimistic estimate to
      // have run out - not merely the pessimistic one.
      if (new Date(window.from) <= session.scheduledEnd) continue;

      const actor: QueueActor = {
        accountId: null,
        hospitalId: session.hospitalId,
        type: 'SYSTEM',
      };

      try {
        const result = await closeRegistration(this.queue, session.id, actor, {
          reason: 'Anyone joining now would not be seen before the session ends',
        });
        if (!result.alreadyClosed) closed.push(session.id);
      } catch (error) {
        this.log.warn({ err: error, sessionId: session.id }, 'cutoff refused by the state machine');
      }
    }

    return closed;
  }
}
