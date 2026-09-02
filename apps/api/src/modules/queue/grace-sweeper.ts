import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Sweeper } from '../../common/sweeper';
import { QueuePolicyService } from '../config/queue-policy.service';
import { QueueService, type QueueActor } from './queue.service';
import { skip } from './commands/skip';
import { noShow } from './commands/no-show';
import { requeue } from './commands/requeue';

/**
 * P8-BE-03 · the no-show road, walked without anybody watching (docs/PRD.md 8.8).
 *
 * ```
 * called -> grace expires -> passed over -> back in the queue   (while recalls remain)
 *                                        -> marked absent        (once they are spent)
 * ```
 *
 * **Every threshold comes from the hospital's own `QueuePolicy`** - `gracePeriodSec`
 * and `recallAttempts` - and none of it is hardcoded here. That is the whole reason
 * they are per-hospital columns, and the `skip` command has said so since Phase 4:
 * *"the threshold is never hardcoded in this file; the policy owns it."*
 *
 * **It mutates nothing directly.** It issues the same SKIP, REQUEUE and NO_SHOW
 * commands a receptionist issues, so the state machine, the audit log, the queue
 * timeline and the realtime broadcast all apply to a timer exactly as they do to a
 * person. docs/Phases.md calls writing rows from a worker *"the single most damaging
 * shortcut available in this phase"*.
 *
 * The actor is SYSTEM, so the audit trail says plainly that nobody decided this - a
 * clock did.
 */

/** Grace periods are minutes; checking every fifteen seconds is close enough. */
const INTERVAL_MS = 15_000;

/** One pass handles at most this many, so a backlog cannot hold the lock loop. */
const MAX_PER_SWEEP = 20;

@Injectable()
export class GraceSweeper extends Sweeper {
  protected readonly name = 'grace';
  protected readonly intervalMs = INTERVAL_MS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly policies: QueuePolicyService,
  ) {
    super();
  }

  protected async sweep(): Promise<void> {
    await this.expireGrace();
  }

  /** Public so a test runs one deterministic pass. Returns what it acted on. */
  async expireGrace(now: Date = new Date()): Promise<string[]> {
    // Candidates first, cheaply: everyone currently CALLED in a live session. The
    // grace period is per hospital, so the deadline cannot be a SQL comparison
    // without joining policy in - and there are only ever a handful of CALLED
    // entries at once, because call-next refuses while anyone is already called.
    const called = await this.prisma.queueEntry.findMany({
      where: {
        status: 'CALLED',
        calledAt: { not: null },
        session: { status: 'ACTIVE', pausedAt: null },
      },
      select: {
        id: true,
        hospitalId: true,
        sessionId: true,
        calledAt: true,
        recallCount: true,
      },
      orderBy: { calledAt: 'asc' },
      take: MAX_PER_SWEEP,
    });
    if (called.length === 0) return [];

    const acted: string[] = [];

    for (const entry of called) {
      const policy = await this.policies.ensure(entry.hospitalId);
      const deadline = new Date(entry.calledAt!.getTime() + policy.gracePeriodSec * 1000);
      if (now < deadline) continue;

      const actor: QueueActor = {
        accountId: null,
        hospitalId: entry.hospitalId,
        type: 'SYSTEM',
      };

      try {
        // SKIP first, always. It is what increments `recallCount`, and it is the
        // state a patient can be rescued from by walking up to the desk.
        await skip(this.queue, entry.sessionId, actor, {
          entryId: entry.id,
          reason: `No response within the ${policy.gracePeriodSec}s grace period`,
        });

        // `skip` incremented it, so the value that matters is one higher than the
        // one read above.
        const attemptsUsed = entry.recallCount + 1;

        if (attemptsUsed >= policy.recallAttempts) {
          // Every recall spent. This is the end of the road (docs/PRD.md 8.8).
          await noShow(this.queue, entry.sessionId, actor, { entryId: entry.id });
        } else {
          // Back into the pool for another go. `requeue` is what puts them at the
          // BACK rather than at their token position, which is the whole reason
          // `requeuedAt` exists - otherwise the same absent patient is offered to
          // the doctor again immediately, which is the loop grace exists to stop.
          await requeue(this.queue, entry.sessionId, actor, { entryId: entry.id });
        }
        acted.push(entry.id);
      } catch (error) {
        // A receptionist got there first and the state machine refused us. That is
        // the system working: they had better information than this timer did.
        this.log.warn(
          { err: error, entryId: entry.id },
          'grace expiry skipped - the entry moved before the timer reached it',
        );
      }
    }

    return acted;
  }
}
