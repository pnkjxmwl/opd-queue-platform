import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Sweeper } from '../../common/sweeper';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ELIGIBLE_TO_CALL } from '../queue/state-machine';

/**
 * P7-BE-04 · time passing is itself an event.
 *
 * Every other update in the product is caused by somebody doing something. This one
 * is caused by nobody doing anything, and it is the case docs/Phases.md singles out:
 * *"an idle doctor (the window must drift later on each tick)"*. If the doctor takes
 * a twenty-minute phone call, no command runs, no event fires, and without this every
 * waiting patient's screen would keep promising a time that has quietly become
 * impossible.
 *
 * It changes nothing. It writes no rows and bumps no version - it re-broadcasts the
 * session's *current* version, and the clients refetch and get a window computed from
 * a later `now`. The ETA is anchored to the clock, so recomputing is all it takes.
 *
 * **A sweep, not BullMQ** - exactly the precedent `queue/reservation-sweeper.ts`
 * set in Phase 5, for the same reason: docs/Phases.md gives worker infrastructure to
 * Phase 8 (kill switches, stable job ids, the "workers call commands, never write
 * rows" rule) and lists `eta-tick` there again. Nothing here depends on the period
 * for correctness, only on it eventually running.
 *
 * **It extends `Sweeper` as of the pre-production audit, and that is not cosmetic.**
 * It used to hand-roll its own interval, overlap flag and test bail-out - the same
 * code the base class already had - and in copying the mechanics it missed the one
 * thing that only lives there: the `DISABLED_WORKERS` check. `env.ts` listed
 * `eta-tick` as a name you could switch off, and switching it off did nothing at
 * all. A kill switch you reach for when a timer is flooding production is worth
 * exactly nothing if it silently no-ops.
 */

/**
 * Slow on purpose. The window is never narrower than ±5 minutes, so a faster tick
 * would repaint the same answer - and docs/Phases.md names ETA thrash as a real UX
 * bug: *"recomputing on every single event makes the number jump around and destroys
 * trust."* One minute is smoothing, not laziness.
 */
const TICK_INTERVAL_MS = 60_000;

/** One tick touches at most this many sessions, so a busy day cannot flood the socket. */
const MAX_SESSIONS_PER_TICK = 50;

@Injectable()
export class EtaTick extends Sweeper {
  protected readonly name = 'eta-tick';
  protected readonly intervalMs = TICK_INTERVAL_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {
    super();
  }

  /**
   * The base class handles the interval, the test bail-out, the kill switch and the
   * overlap guard - a tick that overlapped the previous one would double every
   * broadcast, and skipping is free because the next one is a minute away and
   * computes from the clock regardless.
   */
  protected async sweep(): Promise<void> {
    await this.tick();
  }

  /**
   * Re-broadcast every session where somebody is actually waiting.
   *
   * Exported for the tests, which call it directly rather than waiting a minute.
   * Returns the sessions it nudged so a test can assert on them.
   */
  async tick(): Promise<string[]> {
    const sessions = await this.prisma.oPDSession.findMany({
      where: {
        status: { in: ['OPEN_FOR_REGISTRATION', 'ACTIVE'] },
        // A doctor who has left is not going to see anyone, and a paused queue is
        // not moving. Broadcasting a drifting estimate for either would be inventing
        // precision about a queue that is stopped.
        doctorPresence: { not: 'LEFT' },
        pausedAt: null,
        // Somebody has to be waiting for a wait to be worth re-estimating.
        entries: { some: { status: { in: [...ELIGIBLE_TO_CALL] } } },
      },
      select: { id: true, version: true },
      orderBy: { scheduledStart: 'asc' },
      take: MAX_SESSIONS_PER_TICK,
    });

    for (const session of sessions) {
      // The SAME version it already has: nothing was commanded and nothing changed
      // in the database. A client drops an event only when it holds a strictly
      // greater version, so an equal one still means "re-read me".
      this.realtime.emitSessionUpdate(session.id, session.version);
    }

    return sessions.map((s) => s.id);
  }
}
