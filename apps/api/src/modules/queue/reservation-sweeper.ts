import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { env } from '../../config/env';
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
 * rows" rule - and reservation-expiry is listed there again. A `setInterval` that
 * calls a domain command is the smallest thing that does the job, and Phase 8 can
 * replace it without changing a single rule.
 *
 * It mutates state ONLY through the queue command, so the state machine, the audit
 * log and the events all apply exactly as they would to a human action - the
 * shortcut docs/Phases.md Phase 8 calls the most damaging one available.
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
export class ReservationSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ReservationSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit(): void {
    // Never on its own in tests: an interval firing mid-fixture is a flake generator,
    // and every expiry path is tested by calling sweep() directly instead.
    if (env().NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => void this.safeSweep(), SWEEP_INTERVAL_MS);
    // Do not keep the process alive just to run a timer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
    }
  }

  private async safeSweep(): Promise<void> {
    // Overlapping sweeps would queue up behind each other on the same session locks.
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.sweep();
    } catch (error) {
      // A background timer must never take the process down, and the next tick is a
      // free retry (docs/Rules.md 7 - fail loudly in the log, safely in the process).
      this.log.error({ err: error }, 'reservation sweep failed');
    } finally {
      this.running = false;
    }
  }

  /**
   * Cancel every reservation whose hold has lapsed. Returns how many it cancelled.
   *
   * Grouped by session because the lock is per session: one transaction per session
   * expires all of its lapsed holds together, rather than taking the same lock once
   * per row.
   */
  async sweep(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.queueEntry.findMany({
      where: { status: 'RESERVED', reservationExpiresAt: { lte: now } },
      select: { id: true, sessionId: true, hospitalId: true },
      orderBy: { reservationExpiresAt: 'asc' },
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
