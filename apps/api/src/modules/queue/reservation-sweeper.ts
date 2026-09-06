import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Sweeper } from '../../common/sweeper';
import { QueueService, type QueueActor } from './queue.service';
import { applyCancellation } from './commands/cancel-entry';

/**
 * P5-BE-03 · marks lapsed unpaid holds CANCELLED.
 *
 * **This is bookkeeping, not the mechanism.** The slot is freed by
 * `QueueEntry.reservationExpiresAt` itself: every rule that counts bookings already
 * ignores a RESERVED entry past that instant, so a session never oversells even if
 * this never runs. What the sweeper adds is that the patient's own screen stops
 * saying "awaiting payment" for a hold that is gone, and that the row reaches a
 * terminal state instead of waiting for `END_SESSION` to tidy it.
 *
 * That distinction is why BullMQ is not here. docs/Architecture.md 11 plans a
 * delayed job per reservation, but Phase 8 is where worker infrastructure is
 * designed - kill switches, stable job ids, the "workers call commands, never write
 * rows" rule - and reservation-expiry is listed there again. A sweep that calls a
 * domain command is the smallest thing that does the job.
 *
 * It mutates state ONLY through the queue command, so the state machine, the audit
 * log and the events all apply exactly as they would to a human action - the
 * shortcut docs/Phases.md Phase 8 calls the most damaging one available.
 *
 * **It extends `Sweeper` as of the pre-production audit.** This file wrote the
 * pattern in Phase 5 and then never adopted the base class Phase 8 extracted from
 * it, so it kept its own copy of the interval, the overlap flag and the test
 * bail-out - and never gained the `DISABLED_WORKERS` check that only lives there.
 * `env.ts` listed `reservation` among the workers you could switch off, and
 * switching it off did nothing.
 */

/**
 * Frequent enough that a lapsed hold is tidied while the patient is still looking at
 * the screen, rare enough to be invisible against a clinic's real load. Nothing
 * depends on the period for correctness - only on it eventually running.
 */
const SWEEP_INTERVAL_MS = 60_000;

/** One sweep touches at most this many sessions, so a backlog cannot hold the lock loop. */
const MAX_SESSIONS_PER_SWEEP = 20;

@Injectable()
export class ReservationSweeper extends Sweeper {
  protected readonly name = 'reservation';
  protected readonly intervalMs = SWEEP_INTERVAL_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {
    super();
  }

  /**
   * The base class owns the interval, the kill switch, the test bail-out and the
   * overlap guard - overlapping sweeps would queue up behind each other on the same
   * session locks. `expire()` stays public and takes a clock so tests can run one
   * pass at an instant of their choosing, which is the shape every other sweeper in
   * this codebase already uses.
   */
  protected async sweep(): Promise<void> {
    await this.expire();
  }

  /**
   * Cancel every reservation whose hold has lapsed. Returns how many it cancelled.
   *
   * Grouped by session because the lock is per session: one transaction per session
   * expires all of its lapsed holds together, rather than taking the same lock once
   * per row.
   */
  async expire(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.queueEntry.findMany({
      where: { status: 'RESERVED', reservationExpiresAt: { lte: now } },
      select: { id: true, sessionId: true, hospitalId: true },
      orderBy: { reservationExpiresAt: 'asc' },
      /**
       * Bounded, because the work below is. Without this the sweep read every
       * lapsed hold on the platform each minute and then threw all but
       * MAX_SESSIONS_PER_SWEEP sessions of it away - fine on a quiet day, and a
       * full scan every sixty seconds after any backlog. Generous enough that the
       * session cap, not this, is what actually limits a pass.
       */
      take: MAX_SESSIONS_PER_SWEEP * 50,
    });
    if (expired.length === 0) {
      return 0;
    }

    const bySession = new Map<string, { hospitalId: string; entryIds: string[] }>();
    for (const row of expired) {
      const group = bySession.get(row.sessionId);
      if (group === undefined) {
        bySession.set(row.sessionId, { hospitalId: row.hospitalId, entryIds: [row.id] });
      } else {
        group.entryIds.push(row.id);
      }
    }

    let cancelled = 0;
    for (const [sessionId, group] of [...bySession].slice(0, MAX_SESSIONS_PER_SWEEP)) {
      const actor: QueueActor = {
        accountId: null,
        hospitalId: group.hospitalId,
        type: 'SYSTEM',
      };

      try {
        cancelled += await this.queue.runCommand({
          sessionId,
          actor,
          command: 'EXPIRE_RESERVATION',
          reason: 'Reservation expired before payment was confirmed',
          handler: async (ctx) => {
            let n = 0;
            for (const entryId of group.entryIds) {
              const { changed } = await applyCancellation(
                ctx,
                entryId,
                'EXPIRE_RESERVATION',
                'Reservation expired before payment was confirmed',
              );
              // Count what this sweep actually changed, not rows that were already
              // cancelled by a patient withdrawing a moment earlier.
              if (changed) {
                n += 1;
              }
            }
            return n;
          },
        });
      } catch (error) {
        // A session that has since ended refuses the command, and that is correct -
        // END_SESSION already turned its RESERVED rows into CANCELLED. Log and carry
        // on; one unhappy session must not stop the rest of the sweep.
        this.log.warn({ err: error, sessionId }, 'could not expire reservations for session');
      }
    }

    return cancelled;
  }
}
