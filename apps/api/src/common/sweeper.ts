import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { env } from '../config/env';

/**
 * The shape every background worker in this codebase shares (P8-BE-03..05).
 *
 * **They are sweeps over database state, not queued jobs**, and that is the central
 * decision of Phase 8. docs/Architecture.md 12 planned BullMQ; Phase 5 had already
 * departed from it for `reservation-expiry` with an argument that turns out to cover
 * every worker here:
 *
 * > the column, not a job, is what frees the slot - the sweeper only writes down what
 * > is already true.
 *
 * The same is true of all of them. A called patient is out of time when
 * `calledAt + gracePeriodSec` has passed, whether or not anything fired; registration
 * is past its cutoff when the clock says so; a payment is unreconciled when its row
 * says PENDING. So the state IS the schedule, and a sweep has properties a delayed
 * job does not:
 *
 * - **It cannot lose work.** A job enqueued between a command committing and the
 *   process restarting is simply gone. A sweep re-derives everything outstanding on
 *   its next pass, so an outage self-heals - which is exactly what docs/Phases.md
 *   asks for ("if a worker was off, it should be able to catch the system up rather
 *   than requiring manual repair").
 * - **It is idempotent by construction.** docs/Phases.md requires every job to be
 *   idempotent with a stable `jobId` because "BullMQ can deliver twice". A sweep that
 *   selects rows *needing* work and issues domain commands has nothing to deliver
 *   twice: the second pass finds nothing to do.
 * - **It needs no new dependency, no job state, and no second thing to operate.**
 *
 * The cost is precision: a sweep acts within one interval of the moment rather than
 * at it. Grace periods and cutoffs are measured in minutes, so that is affordable.
 * If a job ever needs to fire *at* a second, BullMQ is still the right answer and
 * this seam is where it goes.
 *
 * **Workers mutate state only by calling domain commands** (docs/Phases.md, verbatim),
 * so the state machine, the audit log and the realtime events apply to a timer's
 * action exactly as they do to a receptionist's.
 */
export abstract class Sweeper implements OnModuleInit, OnModuleDestroy {
  protected readonly log = new Logger(this.constructor.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  /** Name used by the `DISABLED_WORKERS` kill switch. Keep it short and greppable. */
  protected abstract readonly name: string;
  protected abstract readonly intervalMs: number;

  /** One pass. Must be safe to call twice and safe to call after an outage. */
  protected abstract sweep(): Promise<void>;

  onModuleInit(): void {
    // Never on its own in tests: a timer firing mid-fixture is a flake generator, and
    // every path is tested by calling sweep() directly instead.
    if (env().NODE_ENV === 'test') return;

    // docs/Phases.md: "Give every worker its own env-flag kill switch, so a
    // misbehaving timer can be disabled without a redeploy."
    if (env().DISABLED_WORKERS.includes(this.name)) {
      this.log.warn(`${this.name} is disabled by DISABLED_WORKERS`);
      return;
    }

    this.timer = setInterval(() => void this.safeSweep(), this.intervalMs);
    // Never keep the process alive just to run a timer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  /**
   * Public so tests can run exactly one pass, deterministically, with no timer.
   *
   * Overlap is skipped rather than queued: the next pass is moments away and
   * re-derives everything outstanding anyway, so two passes racing over the same
   * rows buys nothing and costs a lock fight.
   */
  async safeSweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (error) {
      // A worker that dies takes every future pass with it. Log and live.
      this.log.error({ err: error }, `${this.name} sweep failed`);
    } finally {
      this.running = false;
    }
  }
}
