import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  RazorpayWebhookEvent,
  type CancelEntryRequest,
  type CancelEntryResponse,
  type JoinRequest,
  type JoinResponse,
  type MyQueueEntriesQuery,
  type MyQueueEntry,
  type Paginated,
  type QueueEntryStatus,
  type StaffCancelEntryRequest,
  type StaffCancelEntryResponse,
  type WebhookAck,
} from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { env } from '../../config/env';
import { NotFoundError, ValidationFailedError } from '../../common/errors';
import { isUniqueViolation } from '../../common/prisma-errors';
import { QueueService, type CommandContext, type QueueActor } from '../queue/queue.service';
import { QueuePolicyService } from '../config/queue-policy.service';
import { joinQueue } from '../queue/commands/join';
import { applyPaymentConfirmation } from '../queue/commands/confirm-payment';
import { applyCancellation } from '../queue/commands/cancel-entry';
import { toCommandResult } from '../queue/commands/result';
import { RazorpayClient } from './razorpay.client';
import {
  MY_ENTRY_INCLUDE,
  loadSessionLiveView,
  refundPctIfCancelledAt,
  toMyQueueEntry,
  type MyEntryRow,
} from './my-entry';

/**
 * Join, pay, cancel (docs/Architecture.md 10, docs/PRD.md 10).
 *
 * Three rules shape every method here, and all three come from money having already
 * moved by the time we find out about it:
 *
 *   1. **The client never creates a token.** Only a signature-verified webhook does.
 *   2. **The amount is never sent by the client.** It is read from the locked
 *      session row inside the join command.
 *   3. **A replay is a no-op, not an error.** Razorpay retries anything non-2xx, so
 *      answering "already handled" with a failure turns one successful payment into
 *      a retry storm.
 *
 * Every write to a `QueueEntry` goes through a Phase-4 domain command, never a direct
 * update (docs/Rules.md 1.2). This module owns `Payment` and `Refund` and writes
 * those itself, inside the same transaction the command opens, so a paid entry and
 * its payment record can never disagree.
 */

/** Statuses a patient still has something to do about. Everything else is history. */
const ACTIVE_STATUSES: QueueEntryStatus[] = [
  'RESERVED',
  'CONFIRMED',
  'VIRTUAL_WAITING',
  'CHECKED_IN',
  'READY',
  'CALLED',
  'IN_CONSULTATION',
  'SKIPPED',
];
const PAST_STATUSES: QueueEntryStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'];

/**
 * Where Razorpay sends the browser back after a redirect-mode payment.
 *
 * `PUBLIC_BASE_URL` when configured - a real, reachable address, which is what the
 * gateway expects and what a phone can load. The sentinel fallback keeps join working
 * on a machine with no tunnel: the client intercepts that URL before the WebView
 * tries to resolve it, so the flow still completes, it is just less forgiving if the
 * interception ever misses.
 */
export const CHECKOUT_RETURN_PATH = '/webhooks/checkout-complete';

export function checkoutReturnUrl(config = env()): string {
  const base = config.PUBLIC_BASE_URL.replace(/\/+$/, '');
  // The sentinel host is deliberately unresolvable: with no tunnel there is nothing
  // real to come back to, and the client intercepts it before the WebView tries.
  return `${base === '' ? 'https://opd-queue.local' : base}${CHECKOUT_RETURN_PATH}`;
}

/** A refund that was actually written, and therefore has to reach the gateway. */
interface RaisedRefund {
  refundId: string;
  paymentId: string;
  amountPaise: number;
}

/**
 * What a cancellation owes the patient, written inside the cancelling transaction.
 *
 * **One function, called by both cancel paths.** The patient cancels their own
 * booking and reception cancels it for them; those differ in who is authorised and
 * in what percentage applies, and in NOTHING about the arithmetic. Phase 5's worst
 * bug was a second refund raised for one cancellation, and duplicating this block
 * for the staff path is precisely how that would come back.
 *
 * The caller must already have checked that the cancellation actually CHANGED
 * something. A no-op cancel that reached here would refund an entry that was
 * already cancelled - which is the Phase-5 bug verbatim.
 *
 * Returns null when there is nothing to give back: no payment, an unpaid hold, a 0%
 * tier, or a booking already refunded in full.
 */
async function refundForCancellation(
  ctx: CommandContext,
  input: { entryId: string; hospitalId: string; pct: number; reason: string },
): Promise<RaisedRefund | null> {
  // Re-read under the session lock. Computing `refundedPaise` from a row fetched
  // before the transaction is how two concurrent cancels each refund the full
  // amount.
  const payment = await ctx.tx.payment.findUnique({
    where: { queueEntryId: input.entryId },
    select: { id: true, status: true, amountPaise: true, refundedPaise: true },
  });
  if (payment === null || payment.status !== 'SUCCESS') {
    return null;
  }

  const refundable = Math.floor((payment.amountPaise * input.pct) / 100) - payment.refundedPaise;
  if (refundable <= 0) {
    return null;
  }

  const refund = await ctx.tx.refund.create({
    data: {
      hospitalId: input.hospitalId,
      paymentId: payment.id,
      amountPaise: refundable,
      status: 'PENDING',
      reason: input.reason,
    },
    select: { id: true },
  });

  const refundedTotal = payment.refundedPaise + refundable;
  await ctx.tx.payment.update({
    where: { id: payment.id },
    data: {
      refundedPaise: refundedTotal,
      status: refundedTotal >= payment.amountPaise ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    },
  });

  return { refundId: refund.id, paymentId: payment.id, amountPaise: refundable };
}

@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly policies: QueuePolicyService,
    private readonly razorpay: RazorpayClient,
  ) {}

  // -------------------------------------------------------------------------
  // Join
  // -------------------------------------------------------------------------

  /**
   * P5-BE-01 · reserve a place and open a Razorpay order for it.
   *
   * The reservation is committed BEFORE the gateway is called, deliberately: a
   * Razorpay round trip inside the session transaction would hold the lock every
   * other command in that clinic is waiting on (docs/Rules.md 4). If the order then
   * fails, the hold simply lapses - the failure mode is self-healing rather than a
   * half-written booking.
   */
  async join(sessionId: string, accountId: string, input: JoinRequest): Promise<JoinResponse> {
    if (!this.razorpay.configured) {
      // A misconfigured server, not a domain outcome: the filter turns this into
      // INTERNAL_ERROR and pino keeps this message (docs/Rules.md 7).
      throw new Error(
        'Razorpay is not configured - set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET',
      );
    }

    const hospitalId = await this.hospitalOfSession(sessionId);
    const actor: QueueActor = { accountId, hospitalId, type: 'PATIENT' };

    const outcome = await joinQueue(this.queue, sessionId, actor, {
      patientId: input.patientId,
      accountId,
      reservationTtlSec: env().RESERVATION_TTL_SEC,
    });

    const payment = await this.ensureOrderFor(outcome.entry.id, {
      hospitalId,
      accountId,
      amountPaise: outcome.feePaise,
    });

    return {
      entry: await this.readMyEntry(outcome.entry.id),
      razorpayOrderId: payment.razorpayOrderId,
      razorpayKeyId: this.razorpay.keyId,
      amountPaise: payment.amountPaise,
      currency: 'INR',
      callbackUrl: checkoutReturnUrl(),
    };
  }

  /**
   * The Payment row for this reservation, creating the Razorpay order only if there
   * is not one already.
   *
   * This is what makes a retried join resume instead of charging twice: the second
   * call finds the first call's order and hands back the same one. It also repairs
   * the narrow case where a previous attempt created the reservation and then died
   * before the order was written.
   */
  private async ensureOrderFor(
    entryId: string,
    meta: { hospitalId: string; accountId: string; amountPaise: number },
  ): Promise<{ razorpayOrderId: string; amountPaise: number }> {
    const existing = await this.prisma.payment.findUnique({
      where: { queueEntryId: entryId },
      select: { razorpayOrderId: true, amountPaise: true },
    });
    if (existing !== null) {
      return existing;
    }

    const order = await this.razorpay.createOrder({
      amountPaise: meta.amountPaise,
      // Our entry id, echoed back on every event and visible on the Razorpay
      // dashboard - which is how Phase 8's reconcile worker matches an orphaned
      // order to the reservation it belongs to.
      receipt: entryId,
      notes: { queueEntryId: entryId, hospitalId: meta.hospitalId },
    });

    try {
      return await this.prisma.payment.create({
        data: {
          hospitalId: meta.hospitalId,
          queueEntryId: entryId,
          accountId: meta.accountId,
          amountPaise: meta.amountPaise,
          status: 'CREATED',
          razorpayOrderId: order.id,
        },
        select: { razorpayOrderId: true, amountPaise: true },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Two joins raced past the findUnique above. The row that won is the truth;
        // this request's order is simply an unpaid order nobody will ever use.
        return this.prisma.payment.findUniqueOrThrow({
          where: { queueEntryId: entryId },
          select: { razorpayOrderId: true, amountPaise: true },
        });
      }
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Webhook
  // -------------------------------------------------------------------------

  /**
   * P5-BE-02 · `POST /webhooks/razorpay`.
   *
   * **The signature is checked against the RAW bytes before anything else happens.**
   * Not the parsed body, not a re-serialised copy - `docs/Phases.md` names this as
   * the thing that costs hours, because a re-encoded body produces a different
   * digest even though no value changed.
   *
   * Everything after a valid signature answers 200, including events we ignore and
   * duplicates we have already handled, because a non-2xx makes Razorpay retry.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<WebhookAck> {
    if (rawBody === undefined) {
      // Means the raw-body option is off. Fail loudly rather than verifying a
      // signature over a body we reconstructed - that check would be worthless.
      throw new Error('Raw body unavailable - NestFactory must be created with { rawBody: true }');
    }

    if (!this.razorpay.verifyWebhookSignature(rawBody, signature)) {
      // 400, and no retry expected: whoever sent this was not Razorpay.
      throw new ValidationFailedError('Webhook signature verification failed');
    }

    const parsed = RazorpayWebhookEvent.safeParse(JSON.parse(rawBody.toString('utf8')));
    if (!parsed.success) {
      // Signed by us but shaped in a way we do not understand. A retry cannot fix
      // that, so acknowledge and make it loud in the log instead.
      this.log.error({ issues: parsed.error.issues }, 'unparseable razorpay webhook');
      return { handled: 'IGNORED' };
    }

    const event = parsed.data;
    switch (event.event) {
      case 'payment.captured':
        return this.onPaymentCaptured(event.payload.payment?.entity);
      case 'payment.failed':
        return this.onPaymentFailed(event.payload.payment?.entity);
      case 'refund.processed':
      case 'refund.failed':
        return this.onRefundSettled(event.event, event.payload.refund?.entity);
      default:
        return { handled: 'IGNORED' };
    }
  }

  private async onPaymentCaptured(
    entity: { id: string; order_id?: string | null; amount: number; currency: string } | undefined,
  ): Promise<WebhookAck> {
    const orderId = entity?.order_id;
    if (entity === undefined || !orderId) {
      return { handled: 'IGNORED' };
    }

    const payment = await this.prisma.payment.findUnique({
      where: { razorpayOrderId: orderId },
      select: {
        id: true,
        hospitalId: true,
        accountId: true,
        amountPaise: true,
        status: true,
        razorpayPaymentId: true,
        entry: { select: { id: true, sessionId: true, status: true } },
      },
    });
    // An order we never created - another integration on the same account.
    if (payment === null) {
      return { handled: 'IGNORED' };
    }

    // Defence in depth. The amount came from an order WE created, so it cannot
    // legitimately differ; if it ever does, something is wrong enough that issuing a
    // token on the strength of it would be worse than issuing nothing.
    if (entity.amount !== payment.amountPaise || entity.currency !== 'INR') {
      this.log.error(
        { paymentId: payment.id, expected: payment.amountPaise, got: entity.amount },
        'razorpay capture amount does not match the order - refusing to confirm',
      );
      return { handled: 'IGNORED' };
    }

    if (payment.status === 'SUCCESS' && payment.razorpayPaymentId === entity.id) {
      return { handled: 'DUPLICATE' };
    }

    const session = await this.prisma.oPDSession.findUnique({
      where: { id: payment.entry.sessionId },
      select: { status: true },
    });
    const sessionLive =
      session !== null && (session.status === 'OPEN_FOR_REGISTRATION' || session.status === 'ACTIVE');

    // There is no queue left to join. Take the money on the books, then give it back
    // - the alternative is silently keeping it (docs/Phases.md Phase 5 risks).
    if (!sessionLive) {
      await this.recordCapture(payment.id, entity.id);
      await this.raiseRefund({
        paymentId: payment.id,
        hospitalId: payment.hospitalId,
        amountPaise: payment.amountPaise,
        reason: 'Session ended before the payment was confirmed',
      });
      return { handled: 'REFUND_UPDATED' };
    }

    // The hold had already lapsed and the money arrived anyway. The webhook wins:
    // the token number was never handed to anyone else, so giving the slot back is
    // a status change. Its own command, so the audit trail says which happened.
    const reinstating = payment.entry.status === 'CANCELLED';

    try {
      await this.queue.runCommand({
        sessionId: payment.entry.sessionId,
        actor: { accountId: payment.accountId, hospitalId: payment.hospitalId, type: 'SYSTEM' },
        command: reinstating ? 'REINSTATE' : 'CONFIRM_PAYMENT',
        reason: reinstating ? 'Payment captured after the reservation had expired' : null,
        handler: async (ctx) => {
          // Queue owns the entry write; this module owns the payment write. One
          // transaction, so a paid entry with no payment record is impossible.
          await applyPaymentConfirmation(
            ctx,
            payment.entry.id,
            reinstating ? 'REINSTATE' : 'CONFIRM_PAYMENT',
          );
          await ctx.tx.payment.update({
            where: { id: payment.id },
            data: { status: 'SUCCESS', razorpayPaymentId: entity.id },
          });
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Two copies of the same webhook in flight at once. The unique index on
        // razorpayPaymentId is the replay guard, and losing that race means the
        // other one succeeded - which is success, not an error.
        return { handled: 'DUPLICATE' };
      }
      throw error;
    }

    return { handled: reinstating ? 'REINSTATED' : 'CONFIRMED' };
  }

  /** Marks the attempt failed. The hold stays live so the patient can simply retry. */
  private async onPaymentFailed(entity: { order_id?: string | null } | undefined): Promise<WebhookAck> {
    const orderId = entity?.order_id;
    if (!orderId) {
      return { handled: 'IGNORED' };
    }
    const updated = await this.prisma.payment.updateMany({
      // Never downgrade a payment that already succeeded: Razorpay can report a
      // failed ATTEMPT on an order that a later attempt paid.
      where: { razorpayOrderId: orderId, status: { in: ['CREATED', 'PENDING'] } },
      data: { status: 'FAILED' },
    });
    // Not 'CONFIRMED' - nothing was confirmed. The ack is what a human reads in a
    // log when a payment goes missing, so it must not say the opposite of what
    // happened.
    return { handled: updated.count > 0 ? 'PAYMENT_FAILED' : 'IGNORED' };
  }

  private async onRefundSettled(
    event: string,
    entity: { id: string; payment_id: string; amount: number } | undefined,
  ): Promise<WebhookAck> {
    if (entity === undefined) {
      return { handled: 'IGNORED' };
    }
    const refund = await this.prisma.refund.findFirst({
      where: { razorpayRefundId: entity.id },
      select: { id: true },
    });
    if (refund === null) {
      return { handled: 'IGNORED' };
    }
    await this.prisma.refund.update({
      where: { id: refund.id },
      data: { status: event === 'refund.processed' ? 'PROCESSED' : 'FAILED' },
    });
    return { handled: 'REFUND_UPDATED' };
  }

  private async recordCapture(paymentId: string, razorpayPaymentId: string): Promise<void> {
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'SUCCESS', razorpayPaymentId },
    });
  }

  // -------------------------------------------------------------------------
  // My visits
  // -------------------------------------------------------------------------

  /** P5-BE-04 · the crash-recovery path: what have I booked? */
  async myEntries(accountId: string, query: MyQueueEntriesQuery): Promise<Paginated<MyQueueEntry>> {
    const where: Prisma.QueueEntryWhereInput = {
      accountId,
      status: { in: query.scope === 'active' ? ACTIVE_STATUSES : PAST_STATUSES },
    };

    const [rows, total] = await Promise.all([
      this.prisma.queueEntry.findMany({
        where,
        include: MY_ENTRY_INCLUDE,
        orderBy: { joinedAt: 'desc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.queueEntry.count({ where }),
    ]);

    const items = await this.project(rows);
    return { items, total, limit: query.limit, offset: query.offset };
  }

  /**
   * P5-BE-04 · `POST /queue-entries/:id/cancel`.
   *
   * The refund is RAISED here and settles later. The `Refund` row is written inside
   * the same transaction as the cancellation, so a patient can never lose their
   * place without a refund being on record; the Razorpay call happens after the
   * commit, and a failure there leaves a PENDING row for Phase 8's reconcile worker
   * rather than a silently swallowed obligation.
   */
  async cancel(
    entryId: string,
    accountId: string,
    input: CancelEntryRequest,
  ): Promise<CancelEntryResponse> {
    // Scoped to the caller's own account: an entry id from a URL is
    // attacker-controlled, and a bare lookup here would let anyone cancel anyone
    // else's booking (docs/Rules.md 1.3).
    const entry = await this.prisma.queueEntry.findFirst({
      where: { id: entryId, accountId },
      select: {
        id: true,
        sessionId: true,
        hospitalId: true,
        session: { select: { scheduledStart: true } },
        payment: { select: { id: true, status: true, amountPaise: true, refundedPaise: true } },
      },
    });
    if (entry === null) {
      throw new NotFoundError('Booking not found');
    }

    const policy = await this.policies.ensure(entry.hospitalId);
    const now = new Date();
    const pct = refundPctIfCancelledAt(policy.cancellationRules, entry.session.scheduledStart, now);

    /**
     * Everything about money is decided INSIDE the transaction, under the session
     * lock, from a fresh read.
     *
     * It used to be computed from the read above, outside the lock, and raised
     * whether or not the cancellation actually did anything - so a second tap on
     * Cancel found an already-CANCELLED entry, no-opped the state change, and then
     * happily wrote a SECOND refund row and called Razorpay again. `changed` is the
     * guard, and re-reading the payment is what stops a stale `refundedPaise`
     * refunding the same money twice.
     */
    const raised = await this.queue.runCommand({
      sessionId: entry.sessionId,
      actor: { accountId, hospitalId: entry.hospitalId, type: 'PATIENT' },
      command: 'CANCEL_ENTRY',
      reason: input.reason ?? null,
      handler: async (ctx): Promise<RaisedRefund | null> => {
        const { changed } = await applyCancellation(
          ctx,
          entry.id,
          'CANCEL_ENTRY',
          input.reason ?? null,
        );
        if (!changed) {
          return null;
        }
        return refundForCancellation(ctx, {
          entryId: entry.id,
          hospitalId: entry.hospitalId,
          pct,
          reason: input.reason ?? `Cancelled by patient (${pct}% per hospital policy)`,
        });
      },
    });

    if (raised !== null) {
      await this.sendRefundToGateway(raised.refundId, raised.paymentId, raised.amountPaise);
    }

    const refundRow =
      raised === null
        ? null
        : await this.prisma.refund.findUniqueOrThrow({
            where: { id: raised.refundId },
            select: { amountPaise: true, status: true },
          });

    return {
      entry: await this.readMyEntry(entry.id),
      refund: refundRow,
    };
  }

  /**
   * P6-BE-01 · `POST /sessions/:sessionId/cancel-entry` - reception withdraws a
   * booking on someone else's behalf (docs/PRD.md 6.3 "Assist: cancellations").
   *
   * **Scoped by hospital, never by account.** The patient path above finds the entry
   * by `accountId` because it is the caller's own; this one has no such relationship
   * and must instead prove the entry belongs to the caller's hospital - which is why
   * the route carries `:sessionId` and the entry is looked up within it.
   *
   * The refund percentage comes from `cause`, and that is the whole reason `cause`
   * exists. A single fixed rule is wrong half the time: always 100% makes the desk a
   * way around the hospital's own cancellation policy, and always applying the tier
   * charges a patient the hospital itself turned away. So the person cancelling says
   * which happened, in writing, and it lands in the AuditLog.
   */
  async cancelAsStaff(
    sessionId: string,
    actor: QueueActor,
    input: StaffCancelEntryRequest,
  ): Promise<StaffCancelEntryResponse> {
    const session = await this.prisma.oPDSession.findFirst({
      where: { id: sessionId, hospitalId: actor.hospitalId },
      select: { scheduledStart: true },
    });
    if (session === null) {
      throw new NotFoundError('Session not found');
    }

    const policy = await this.policies.ensure(actor.hospitalId);
    const pct =
      input.cause === 'HOSPITAL'
        ? 100
        : refundPctIfCancelledAt(policy.cancellationRules, session.scheduledStart, new Date());

    const outcome = await this.queue.runCommand({
      sessionId,
      actor,
      command: 'CANCEL_ENTRY',
      reason: input.reason,
      handler: async (ctx) => {
        // entryInSession, not a bare findUnique: an entry id in a request body is
        // attacker-controlled, and this verifies it is in the session the caller was
        // authorised for rather than someone else's (docs/Rules.md 1.3).
        const { entry, changed } = await applyCancellation(
          ctx,
          input.entryId,
          'CANCEL_ENTRY',
          input.reason,
        );
        const raised = changed
          ? await refundForCancellation(ctx, {
              entryId: entry.id,
              hospitalId: ctx.session.hospitalId,
              pct,
              reason: `${input.reason} (${input.cause === 'HOSPITAL' ? 'hospital cancelled' : 'patient request'}, ${pct}%)`,
            })
          : null;
        return { result: toCommandResult(ctx, entry), raised };
      },
    });

    if (outcome.raised !== null) {
      await this.sendRefundToGateway(
        outcome.raised.refundId,
        outcome.raised.paymentId,
        outcome.raised.amountPaise,
      );
    }

    const refundRow =
      outcome.raised === null
        ? null
        : await this.prisma.refund.findUniqueOrThrow({
            where: { id: outcome.raised.refundId },
            select: { amountPaise: true, status: true },
          });

    return {
      result: outcome.result,
      refund: refundRow === null ? null : { ...refundRow, refundPct: pct },
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Raise a refund with Razorpay for a row already written as PENDING.
   *
   * Never throws onward: the cancellation has already committed and is correct. A
   * gateway failure leaves the row PENDING with no gateway id, which is precisely
   * what Phase 8's payment-reconcile worker looks for. Failing the request instead
   * would tell the patient their cancellation did not work, when it did.
   */
  private async sendRefundToGateway(
    refundId: string,
    paymentId: string,
    amountPaise: number,
  ): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { razorpayPaymentId: true },
    });
    if (payment?.razorpayPaymentId == null || !this.razorpay.configured) {
      return;
    }

    try {
      const result = await this.razorpay.refund({
        paymentId: payment.razorpayPaymentId,
        amountPaise,
        notes: { refundId },
      });
      await this.prisma.refund.update({
        where: { id: refundId },
        data: { razorpayRefundId: result.id },
      });
    } catch (error) {
      this.log.error({ err: error, refundId }, 'refund request to razorpay failed - left PENDING');
    }
  }

  /** A refund raised by the server rather than by a patient cancelling. */
  private async raiseRefund(input: {
    paymentId: string;
    hospitalId: string;
    amountPaise: number;
    reason: string;
  }): Promise<void> {
    const refund = await this.prisma.refund.create({
      data: {
        hospitalId: input.hospitalId,
        paymentId: input.paymentId,
        amountPaise: input.amountPaise,
        status: 'PENDING',
        reason: input.reason,
      },
      select: { id: true },
    });
    // Increment, never assign. Today this only ever runs on a freshly captured
    // payment where the total is zero, so the two are identical - but an assignment
    // silently erases an earlier partial refund the day that stops being true, and
    // that is money.
    await this.prisma.payment.update({
      where: { id: input.paymentId },
      data: { refundedPaise: { increment: input.amountPaise }, status: 'REFUNDED' },
    });
    await this.sendRefundToGateway(refund.id, input.paymentId, input.amountPaise);
  }

  async readMyEntry(entryId: string): Promise<MyQueueEntry> {
    const row = await this.prisma.queueEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: MY_ENTRY_INCLUDE,
    });
    const projected = await this.project([row]);
    const first = projected[0];
    if (first === undefined) {
      // Unreachable: project() maps one-for-one over the rows it is given. Handled
      // rather than asserted because `noUncheckedIndexedAccess` is on for a reason.
      throw new NotFoundError('Booking not found');
    }
    return first;
  }

  private async project(rows: MyEntryRow[]): Promise<MyQueueEntry[]> {
    if (rows.length === 0) {
      return [];
    }
    const now = new Date();
    const sessionIds = [...new Set(rows.map((r) => r.sessionId))];
    const hospitalIds = [...new Set(rows.map((r) => r.hospitalId))];

    const [views, policies] = await Promise.all([
      Promise.all(sessionIds.map(async (id) => [id, await loadSessionLiveView(this.prisma, id)] as const)),
      // read, not ensure: this is the projection behind GET /me/queue-entries, and
      // a GET has no business inserting a QueuePolicy row (see discovery).
      Promise.all(hospitalIds.map(async (id) => [id, await this.policies.read(id)] as const)),
    ]);
    const viewBySession = new Map(views);
    const policyByHospital = new Map(policies);

    return rows.map((row) =>
      toMyQueueEntry(
        row,
        // Both maps are keyed from these very rows, so a miss is impossible.
        viewBySession.get(row.sessionId)!,
        policyByHospital.get(row.hospitalId)!.cancellationRules,
        now,
      ),
    );
  }

  /**
   * The hospital a session belongs to.
   *
   * A patient has no HospitalStaff membership, so `TenantGuard` cannot resolve this
   * and the join route deliberately keeps `:id` rather than `:sessionId` (trap 12).
   * The hospital still comes from the SESSION ROW and never from the request - the
   * client names a session, the server decides what that means.
   */
  private async hospitalOfSession(sessionId: string): Promise<string> {
    const session = await this.prisma.oPDSession.findUnique({
      where: { id: sessionId },
      select: { hospitalId: true },
    });
    if (session === null) {
      throw new NotFoundError('Session not found');
    }
    return session.hospitalId;
  }
}
