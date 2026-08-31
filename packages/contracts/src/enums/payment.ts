import { z } from 'zod';

/**
 * Payment lifecycle (docs/PRD.md 10, docs/Architecture.md 5.1).
 *
 * **This is deliberately separate from `QueueEntryStatus`.** docs/PRD.md 7.3 ends
 * with "payment sub-states are tracked separately from queue state", and the reason
 * is concrete: a CHECKED_IN patient can be PARTIALLY_REFUNDED, and an entry that is
 * CANCELLED may have a payment that is still SUCCESS because the refund has not
 * settled yet. Folding the two together would need a status value per combination
 * and would make the queue's state machine depend on a gateway's async callbacks.
 *
 * The values mirror the states Razorpay actually reports, because a status we invent
 * is a status that can silently disagree with the money.
 */
export const PaymentStatus = z.enum([
  /** Order created with Razorpay; nobody has paid anything yet. */
  'CREATED',
  /** The gateway told us an attempt is in flight (`payment.authorized`). */
  'PENDING',
  /** `payment.captured`, signature verified. This is the ONLY state that issues a token. */
  'SUCCESS',
  /** The attempt failed. The reservation is still live until it expires - they may retry. */
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/**
 * Refund lifecycle.
 *
 * A refund is asynchronous: the API call returns "we accepted it", and settlement
 * arrives later on `refund.processed` (docs/Phases.md Phase 5 risks - "refunds are
 * asynchronous too"). PENDING therefore means "requested and accepted by Razorpay",
 * never "the patient has their money".
 */
export const RefundStatus = z.enum(['PENDING', 'PROCESSED', 'FAILED']);
export type RefundStatus = z.infer<typeof RefundStatus>;
