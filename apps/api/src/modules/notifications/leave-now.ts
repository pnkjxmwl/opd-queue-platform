import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Sweeper } from '../../common/sweeper';
import { QueuePolicyService } from '../config/queue-policy.service';
import { EtaService } from '../eta/eta.service';
import { CALL_ORDER } from '../queue/call-order';
import { NotificationsService } from './notifications.service';

/**
 * P8-BE-02 · "time to head over" - the notification the whole product is for.
 *
 * Every other message reports something that happened. This one is a *prediction*,
 * and it is the one that delivers the promise in docs/PRD.md 1: **arrive when your
 * turn is near instead of sitting in a waiting room for hours.** Nothing else in the
 * system tells a patient to get up and leave the house.
 *
 * It fires when the ETA says their turn is within the hospital's own
 * `arriveBeforeMins`, and it fires **once per booking, ever** - enforced by
 * `unique(entryId, type)` in the database, not by a check here. That matters more
 * than it looks: this runs every half-minute, the ETA moves on every tick, and
 * docs/Phases.md is blunt about the failure mode - *"notification storms destroy
 * trust faster than no notifications"*. A patient who is told to leave twelve times
 * stops reading any of them.
 *
 * It deliberately does NOT re-notify when the ETA slips later. Telling somebody
 * already in a taxi that they need not have left is worse than saying nothing, and
 * their screen is live anyway.
 */

const INTERVAL_MS = 30_000;
const MAX_SESSIONS = 30;

@Injectable()
export class LeaveNowNotifier extends Sweeper {
  protected readonly name = 'leave-now';
  protected readonly intervalMs = INTERVAL_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly policies: QueuePolicyService,
    private readonly eta: EtaService,
  ) {
    super();
  }

  protected async sweep(): Promise<void> {
    await this.nudge();
  }

  /** Public for the tests. Returns the entries newly told to set off. */
  async nudge(now: Date = new Date()): Promise<string[]> {
    const sessions = await this.prisma.oPDSession.findMany({
      where: {
        status: { in: ['OPEN_FOR_REGISTRATION', 'ACTIVE'] },
        doctorPresence: { not: 'LEFT' },
        pausedAt: null,
        // Somebody who has BOOKED but not arrived is the only person this can be
        // about. Anyone CHECKED_IN is already standing in the corridor.
        entries: { some: { status: { in: ['CONFIRMED', 'VIRTUAL_WAITING'] }, accountId: { not: null } } },
      },
      select: {
        id: true,
        hospitalId: true,
        currentProviderDoctorId: true,
        hospital: { select: { name: true } },
      },
      take: MAX_SESSIONS,
    });
    if (sessions.length === 0) return [];

    const told: string[] = [];

    for (const session of sessions) {
      const policy = await this.policies.ensure(session.hospitalId);

      // The queue in the order it will actually be called, so "ahead of you" is the
      // number the doctor will really work through - not a token sort, which is
      // wrong the moment anyone is escalated or requeued.
      const present = await this.prisma.queueEntry.findMany({
        where: { sessionId: session.id, status: { in: ['CHECKED_IN', 'READY'] } },
        orderBy: CALL_ORDER,
        select: { id: true },
      });

      const awaited = await this.prisma.queueEntry.findMany({
        where: {
          sessionId: session.id,
          status: { in: ['CONFIRMED', 'VIRTUAL_WAITING'] },
          accountId: { not: null },
          // Nothing to do for anyone already told.
          notifications: { none: { type: 'LEAVE_NOW' } },
        },
        select: { id: true, accountId: true, tokenLabel: true, tokenNumber: true },
        orderBy: { tokenNumber: 'asc' },
      });
      if (awaited.length === 0) continue;

      // Everyone physically present is ahead of somebody still at home
      // (docs/PRD.md 8.2), so they all share one estimate - which is also why this
      // is one ETA call per session rather than one per patient.
      const windows = await this.eta.windowsFor(
        [
          {
            key: session.id,
            sessionId: session.id,
            doctorId: session.currentProviderDoctorId,
            aheadCount: present.length,
            currentStartedAt: null,
            estimable: true,
          },
        ],
        now,
      );
      const window = windows.get(session.id);
      if (window === null || window === undefined) continue;

      // The EARLY edge: if they might be called at 11:05, they need to be walking in
      // by then, not at 11:25. Being early is an inconvenience; being late loses
      // their turn.
      const minutesAway = (new Date(window.from).getTime() - now.getTime()) / 60_000;
      if (minutesAway > policy.arriveBeforeMins) continue;

      for (const entry of awaited) {
        if (entry.accountId === null) continue;
        const isNew = await this.notifications.record({
          accountId: entry.accountId,
          entryId: entry.id,
          sessionId: session.id,
          type: 'LEAVE_NOW',
          tokenLabel: entry.tokenLabel,
          hospitalName: session.hospital.name,
          aheadCount: present.length,
        });
        if (isNew) {
          told.push(entry.id);
          // Write down the promise at the moment it is made.
          //
          // This is the only place the ETA stops being a number computed on demand
          // and becomes a commitment somebody acts on - they put their shoes on
          // because of it. Recording the window here is what makes the estimate
          // falsifiable afterwards: `calledAt` is already stored, so the pair says
          // whether we kept our word.
          //
          // Guarded by `isNew`, so the storm guard on the notification doubles as
          // the write-once guard here: a second sweep must not overwrite the window
          // the patient actually saw with a fresher, flattering one.
          await this.prisma.queueEntry.update({
            where: { id: entry.id },
            data: {
              predictedCallFrom: new Date(window.from),
              predictedCallTo: new Date(window.to),
            },
          });
        }
      }
    }

    return told;
  }
}
