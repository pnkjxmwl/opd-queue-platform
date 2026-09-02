import { Injectable } from '@nestjs/common';
import type { NotificationType } from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { Sweeper } from '../../common/sweeper';
import { NotificationsService } from './notifications.service';

/**
 * P8-BE-02 · turns what happened into what the patient is told.
 *
 * **It reads `QueueEvent`, the append-only timeline, rather than being called from
 * inside the queue commands.** That is the whole design, and it buys three things:
 *
 * 1. **No coupling.** `QueueModule` does not import this, does not know it exists and
 *    cannot be broken by it. A notification bug can never fail a queue command,
 *    which is the right blast radius for something whose worst outcome is a missing
 *    push and whose alternative is a patient not being called.
 * 2. **It catches up.** docs/Phases.md asks that *"if a worker was off, it should be
 *    able to catch the system up rather than requiring manual repair"*. The timeline
 *    is already the record of everything that happened, so a restart re-derives what
 *    was missed instead of losing it - which an enqueue-at-commit design cannot do.
 * 3. **It cannot double-send.** `unique(entryId, type)` on Notification is what stops
 *    that, so re-reading the same event twice is harmless by construction.
 *
 * The cost is latency: a patient hears within one sweep rather than instantly. The
 * realtime socket already carries the instant part - their screen updates the moment
 * the doctor presses the button - so the push is the nudge for a phone in a pocket,
 * and half a minute does not change what it means.
 */

/**
 * Which events are worth a patient's attention. Everything absent from this map is
 * deliberately silent: a pause, a presence change, a priority edit and a
 * consultation starting are all things the patient either cannot act on or is
 * already in the room for.
 */
const NOTIFY_ON: Partial<Record<string, NotificationType>> = {
  ENTRY_CONFIRMED: 'TOKEN_ISSUED',
  ENTRY_CALLED: 'CALLED',
  ENTRY_RECALLED: 'RECALLED',
  ENTRY_SKIPPED: 'SKIPPED',
  ENTRY_NO_SHOW: 'NO_SHOW',
  ENTRY_CANCELLED: 'CANCELLED',
  ENTRY_RESCHEDULED: 'RESCHEDULED',
};

/** Half a minute: fast enough for "you are being called", cheap enough to ignore. */
const INTERVAL_MS = 30_000;

/**
 * How far back a sweep looks. Long enough to ride out a deploy or a short outage,
 * short enough that the scan stays small. Older events are not re-notified: telling
 * somebody they were called yesterday is worse than saying nothing.
 */
const LOOK_BACK_MS = 6 * 60 * 60 * 1000;

const BATCH = 200;

@Injectable()
export class EventNotifier extends Sweeper {
  protected readonly name = 'notify';
  protected readonly intervalMs = INTERVAL_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  protected async sweep(): Promise<void> {
    await this.notifyFromEvents();
  }

  /** Public for the tests, which run one pass rather than waiting half a minute. */
  async notifyFromEvents(): Promise<number> {
    const since = new Date(Date.now() - LOOK_BACK_MS);

    const events = await this.prisma.queueEvent.findMany({
      where: {
        createdAt: { gte: since },
        type: { in: Object.keys(NOTIFY_ON) as never[] },
        // Only entries with an app account behind them: a walk-in registered at the
        // desk has no phone to notify and never asked to be.
        entry: { accountId: { not: null } },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: {
        type: true,
        entryId: true,
        entry: {
          select: {
            id: true,
            accountId: true,
            sessionId: true,
            tokenLabel: true,
            session: { select: { hospital: { select: { name: true } } } },
          },
        },
      },
    });

    let recorded = 0;
    for (const event of events) {
      const type = NOTIFY_ON[event.type];
      const entry = event.entry;
      if (type === undefined || entry === null || entry.accountId === null) continue;

      // `record` swallows the duplicate-key violation, so an event seen on twenty
      // consecutive sweeps produces exactly one notification.
      const isNew = await this.notifications.record({
        accountId: entry.accountId,
        entryId: entry.id,
        sessionId: entry.sessionId,
        type,
        tokenLabel: entry.tokenLabel,
        hospitalName: entry.session.hospital.name,
      });
      if (isNew) recorded += 1;
    }

    return recorded;
  }
}
