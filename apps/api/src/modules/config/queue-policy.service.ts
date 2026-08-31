import { Injectable } from '@nestjs/common';
import {
  CancellationRules,
  DEFAULT_QUEUE_POLICY,
  type OrderingStrategy,
  type QueuePolicy,
  type RequeueBehavior,
  type UpdateQueuePolicyRequest,
} from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { isUniqueViolation } from '../../common/prisma-errors';

type PolicyRow = {
  id: string;
  orderingStrategy: string;
  checkInRequired: boolean;
  walkInEnabled: boolean;
  priorityEnabled: boolean;
  gracePeriodSec: number;
  recallAttempts: number;
  requeueBehavior: string;
  cutoffOnEtaOverrun: boolean;
  cutoffMinsBeforeEnd: number | null;
  maxOnlineTokens: number | null;
  arriveBeforeMins: number;
  cancellationRules: unknown;
  updatedAt: Date;
};

const toDto = (row: PolicyRow): QueuePolicy => ({
  orderingStrategy: row.orderingStrategy as OrderingStrategy,
  checkInRequired: row.checkInRequired,
  walkInEnabled: row.walkInEnabled,
  priorityEnabled: row.priorityEnabled,
  gracePeriodSec: row.gracePeriodSec,
  recallAttempts: row.recallAttempts,
  requeueBehavior: row.requeueBehavior as RequeueBehavior,
  cutoffOnEtaOverrun: row.cutoffOnEtaOverrun,
  cutoffMinsBeforeEnd: row.cutoffMinsBeforeEnd,
  maxOnlineTokens: row.maxOnlineTokens,
  arriveBeforeMins: row.arriveBeforeMins,
  // Parsed, not cast. Every field of CancellationRules defaults, so a row written
  // before a later phase adds a key still yields a complete object instead of
  // throwing on read in production - which is the whole reason it is a JSON column.
  cancellationRules: CancellationRules.parse(row.cancellationRules ?? {}),
  updatedAt: row.updatedAt.toISOString(),
});

const columnsFrom = (input: UpdateQueuePolicyRequest) => ({
  orderingStrategy: input.orderingStrategy,
  checkInRequired: input.checkInRequired,
  walkInEnabled: input.walkInEnabled,
  priorityEnabled: input.priorityEnabled,
  gracePeriodSec: input.gracePeriodSec,
  recallAttempts: input.recallAttempts,
  requeueBehavior: input.requeueBehavior,
  cutoffOnEtaOverrun: input.cutoffOnEtaOverrun,
  cutoffMinsBeforeEnd: input.cutoffMinsBeforeEnd,
  maxOnlineTokens: input.maxOnlineTokens,
  arriveBeforeMins: input.arriveBeforeMins,
  cancellationRules: input.cancellationRules,
});

/**
 * The per-hospital queue rules - one row, the frozen input to the Phase-4 engine.
 *
 * `ensure` is the single place a policy row comes into existence, so the engine can
 * assume one always exists and is complete. The Prisma columns carry no defaults on
 * purpose: the defaults live once, in DEFAULT_QUEUE_POLICY in packages/contracts,
 * because two sets of defaults drift and the database copy is the one nobody reads.
 */
@Injectable()
export class QueuePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Return the hospital's policy, creating it from the contract defaults the first
   * time. A read that writes once is the cheapest way to guarantee the engine never
   * meets a missing policy; the alternative is every caller remembering to seed one.
   *
   * **Read first, and tolerate losing the create race.** This was a plain `upsert`
   * until the Phase-4 queue engine started calling it on every command: two staff
   * acting at the same instant on a hospital whose row did not exist yet both ran
   * the INSERT, and one died on `hospitalId`'s unique constraint - taking a walk-in
   * registration down with it. Prisma's upsert is not atomic against a concurrent
   * insert here, so the constraint violation is caught and re-read instead.
   *
   * The read-first path also keeps a WRITE off the hot path: after the first call
   * for a hospital, this is a single indexed select rather than an upsert on every
   * queue command for the life of the deployment.
   */
  async ensure(hospitalId: string): Promise<QueuePolicy> {
    const existing = await this.prisma.queuePolicy.findUnique({ where: { hospitalId } });
    if (existing !== null) {
      return toDto(existing as PolicyRow);
    }

    try {
      const created = await this.prisma.queuePolicy.create({
        data: { hospitalId, ...columnsFrom(DEFAULT_QUEUE_POLICY) },
      });
      return toDto(created as PolicyRow);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Someone else created it between the read and the write. Their row is just
      // as valid as the one we were about to write - both are the defaults.
      const raced = await this.prisma.queuePolicy.findUniqueOrThrow({ where: { hospitalId } });
      return toDto(raced as PolicyRow);
    }
  }

  /** PUT is a full replace: every field of the request defaults, so `{}` resets. */
  async replace(hospitalId: string, input: UpdateQueuePolicyRequest): Promise<QueuePolicy> {
    const row = await this.prisma.queuePolicy.upsert({
      where: { hospitalId },
      update: columnsFrom(input),
      create: { hospitalId, ...columnsFrom(input) },
    });
    return toDto(row as PolicyRow);
  }
}
