import { z } from 'zod';
import { PageQuery } from '../common/pagination';
import { PaymentStatus, RefundStatus } from '../enums/payment';
import { QueueEntryStatus, QueueEntryType } from '../enums/queue';

/**
 * Join, pay, and the patient's own visits (docs/Architecture.md 6.3, PRD 10).
 *
 * **These are the PATIENT's shapes.** Everything here describes one person's own
 * entry and carries no other patient's name, token or payment - unlike
 * `../queue/dto`, which is the staff console's view of a whole queue. A patient
 * screen must never be built from a staff shape (docs/Rules.md 8, DPDP).
 *
 * Two rules from docs/Rules.md 9 shape every field below:
 *   - the client NEVER sends an amount; the fee is derived from the session
 *   - the client NEVER creates the token; a signature-verified webhook does
 */

// ---------------------------------------------------------------------------
// The patient's own entry
// ---------------------------------------------------------------------------

/**
 * One visit, as its owner sees it. Serves the token card in docs/Design.md 5.6 in a
 * single round trip - a screen that is watched while a queue moves must not need
 * four requests to redraw.
 *
 * The two "ahead" counts are the honest two-number model docs/Design.md 5.6 asks
 * for, and they are NOT the session-wide counts from `QueueSnapshot`: "3 people are
 * checked in ahead of YOU" is a different fact from "12 people are checked in", and
 * only the first one answers the question the patient is actually asking. They are
 * computed with the same call-order comparator the doctor's `call-next` uses, so the
 * number cannot disagree with who is really called next.
 */
export const MyQueueEntry = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),

  status: QueueEntryStatus,
  type: QueueEntryType,
  /**
   * Null for an entry with no payment behind it - a walk-in registered at a desk.
   * Deliberately not folded into `status`; see the note on PaymentStatus.
   */
  paymentStatus: PaymentStatus.nullable(),

  tokenNumber: z.number().int().positive(),
  tokenLabel: z.string(),
  /**
   * The signed, opaque QR reference reception scans (docs/Rules.md 10). Issued when
   * payment is confirmed, so it is null while an entry is still RESERVED - there is
   * nothing to check in to yet. Phase 6 builds the scanner and the signing scheme.
   */
  checkInCode: z.string().nullable(),

  patientId: z.string().uuid(),
  patientName: z.string(),

  hospitalId: z.string().uuid(),
  hospitalName: z.string(),
  hospitalArea: z.string().nullable(),
  departmentName: z.string(),
  /** The doctor actually providing care, which after a substitution is not who was booked. */
  doctorName: z.string(),

  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
  feePaise: z.number().int().nonnegative(),

  /**
   * When an unpaid hold lapses. Non-null only while RESERVED.
   *
   * The client shows a countdown from this rather than running its own clock from
   * the moment it called join: a phone that was backgrounded, or whose clock is
   * wrong, would otherwise disagree with the server about whether the slot is gone.
   */
  reservationExpiresAt: z.string().datetime().nullable(),

  /** The token in consultation right now. Null before anyone has been called. */
  nowServingToken: z.string().nullable(),
  /** Present, waiting, and ahead of this entry in call order. */
  checkedInAheadCount: z.number().int().nonnegative(),
  /** Booked with an earlier token but not yet arrived - they may or may not turn up. */
  bookedAheadCount: z.number().int().nonnegative(),

  /** A window, never a point (docs/Phases.md Phase 7). Both null until Phase 7. */
  etaFrom: z.string().datetime().nullable(),
  etaTo: z.string().datetime().nullable(),

  joinedAt: z.string().datetime(),
  checkedInAt: z.string().datetime().nullable(),
  calledAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),

  /**
   * Whether cancelling would be accepted right now, and what fraction of what they
   * paid would come back (docs/PRD.md 10, `QueuePolicy.cancellationRules`).
   *
   * Advisory, exactly like `QueueSnapshot.registrationOpen`: it exists so the app can
   * say "cancel now - full refund" instead of reimplementing the policy
   * (docs/Rules.md 9), and the server still decides at cancel time, because the free
   * window can close between this read and that write.
   */
  cancellable: z.boolean(),
  refundPctIfCancelledNow: z.number().int().min(0).max(100),
});
export type MyQueueEntry = z.infer<typeof MyQueueEntry>;

/**
 * GET /me/queue-entries
 *
 * `scope` splits the list the way docs/Design.md 5.9's My Visits tab does: what is
 * happening today, and what already happened. Paginated because every list endpoint
 * is (docs/Rules.md 6) - a patient with two years of visits is a real patient.
 */
export const MyQueueEntriesQuery = PageQuery.extend({
  scope: z.enum(['active', 'past']).default('active'),
});
export type MyQueueEntriesQuery = z.infer<typeof MyQueueEntriesQuery>;

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

/**
 * POST /sessions/:id/join
 *
 * **`:id`, not `:sessionId`.** The parameter name is what makes `TenantGuard`
 * demand a staff membership (trap 12 in docs/PROGRESS.md). This route is the
 * opposite of the Phase-4 command routes: it is used by a PATIENT, who has no
 * membership in the hospital they are booking at, so it must keep `:id` and resolve
 * nothing from the tenant.
 *
 * The body names a patient and nothing else. There is no amount, no token number and
 * no hospital: the fee comes from the session, the token from the server, and the
 * hospital from the session row. A client that could send an amount is the single
 * most exploitable payment bug there is (docs/Rules.md 9).
 */
export const JoinRequest = z.object({
  /** Which of the account's patient profiles this visit is for. Ownership is verified server-side. */
  patientId: z.string().uuid(),
});
export type JoinRequest = z.infer<typeof JoinRequest>;

/**
 * Everything Razorpay Checkout needs, plus the entry that is now being held.
 *
 * `keyId` is the publishable half of the key pair and is safe to send - Checkout
 * needs it in the browser/app. The secret never leaves the server, and the signature
 * that actually authorises anything is verified on the webhook.
 *
 * Re-joining a session where this patient already holds a live unpaid reservation
 * returns THIS SAME response rather than creating a second order, so a client that
 * retried through a flaky connection resumes its checkout instead of paying twice.
 */
export const JoinResponse = z.object({
  entry: MyQueueEntry,
  razorpayOrderId: z.string(),
  razorpayKeyId: z.string(),
  amountPaise: z.number().int().positive(),
  currency: z.literal('INR'),
  /**
   * Where Razorpay returns the browser once the payment finishes.
   *
   * Needed because Checkout runs in REDIRECT mode: a WebView cannot give it the
   * popup its default flow wants, so every method that leaves the page - netbanking,
   * wallets - silently never reaches the bank without this.
   *
   * The client intercepts this URL rather than loading it, and still reads the
   * OUTCOME from the server. Nothing in this URL is trusted: it says only "the
   * gateway is done", never "the payment succeeded".
   */
  callbackUrl: z.string().url(),
});
export type JoinResponse = z.infer<typeof JoinResponse>;

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/** POST /queue-entries/:id/cancel */
export const CancelEntryRequest = z.object({
  reason: z.string().trim().min(3).max(280).optional(),
});
export type CancelEntryRequest = z.infer<typeof CancelEntryRequest>;

/**
 * `refund` is null when there was nothing to refund - an unpaid reservation, or a
 * policy tier that returns 0%. A refund that IS raised comes back PENDING, because
 * Razorpay settles it asynchronously; the app must say "refund on its way", never
 * "refunded" (docs/Phases.md Phase 5 risks).
 */
export const CancelEntryResponse = z.object({
  entry: MyQueueEntry,
  refund: z
    .object({
      amountPaise: z.number().int().nonnegative(),
      status: RefundStatus,
    })
    .nullable(),
});
export type CancelEntryResponse = z.infer<typeof CancelEntryResponse>;

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

/**
 * POST /webhooks/razorpay - the shape we rely on from Razorpay's payload.
 *
 * **This is an inbound EXTERNAL shape, not our API contract.** It is here because
 * docs/Rules.md 6 says no unvalidated data reaches a service, and a webhook body is
 * the most hostile input this API accepts. It is deliberately minimal and
 * `passthrough`: Razorpay adds fields without warning, and a strict schema would
 * start rejecting real, signature-valid payments the day they do.
 *
 * The signature is verified against the RAW bytes before this ever parses. Parsing
 * proves nothing about authenticity.
 */
const RazorpayEntity = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ entity: z.object(shape).passthrough() });

export const RazorpayWebhookEvent = z
  .object({
    event: z.string(),
    payload: z
      .object({
        payment: RazorpayEntity({
          id: z.string(),
          /** Null on payloads not tied to an order; such an event is ignored. */
          order_id: z.string().nullable().optional(),
          amount: z.number().int().nonnegative(),
          currency: z.string(),
          status: z.string(),
        }).optional(),
        refund: RazorpayEntity({
          id: z.string(),
          payment_id: z.string(),
          amount: z.number().int().nonnegative(),
          status: z.string(),
        }).optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type RazorpayWebhookEvent = z.infer<typeof RazorpayWebhookEvent>;

/**
 * What the webhook endpoint returns.
 *
 * Always 200 with a body saying what we did, including for an event we ignore or a
 * duplicate we have already processed. Razorpay retries any non-2xx, so returning an
 * error for "already handled" turns a successful payment into a retry storm - a
 * replay must be a silent no-op (docs/Phases.md Phase 5 risks). A BAD SIGNATURE is
 * the exception and is rejected outright: that is not Razorpay talking.
 */
export const WebhookAck = z.object({
  handled: z.enum([
    'CONFIRMED',
    'DUPLICATE',
    'REINSTATED',
    /** A failed ATTEMPT was recorded. The hold stays live so they can retry. */
    'PAYMENT_FAILED',
    'REFUND_UPDATED',
    'IGNORED',
  ]),
});
export type WebhookAck = z.infer<typeof WebhookAck>;
