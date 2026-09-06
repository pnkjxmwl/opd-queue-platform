import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env, paymentsConfigured, type Env } from '../../config/env';

/**
 * Everything this product needs from Razorpay: two calls out, one signature check in.
 *
 * **Deliberately not the `razorpay` SDK** (approved divergence from docs/CLAUDE.md 2,
 * recorded in docs/PROGRESS.md). Creating an order and raising a refund are one POST
 * each, and the webhook signature has to be computed over the RAW request bytes by
 * hand regardless - no SDK can see the body before Nest's JSON parser has consumed
 * and re-serialised it. What is left is small enough that a test can pass a fake
 * object literal instead of mocking a package.
 *
 * Test mode for MVP (docs/PRD.md 10). The base URL is identical either way; the keys
 * are what decide whether the money is real.
 */

const API_BASE = 'https://api.razorpay.com/v1';

/**
 * Long enough for a gateway having a slow minute, short enough that a patient is not
 * left staring at a spinner. A timeout here is safe: the reservation simply expires
 * and the slot comes back.
 */
const REQUEST_TIMEOUT_MS = 10_000;

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
}

export interface RazorpayRefund {
  id: string;
  amount: number;
  status: string;
  /**
   * What we attached when raising it. Carries our own `refundId`, which is how the
   * reconcile worker recognises a refund it already sent but failed to write down -
   * and therefore how it avoids paying a patient twice.
   */
  notes?: Record<string, string> | null;
}

/** One payment against an order, as the reconcile worker needs to see it. */
export interface RazorpayPayment {
  id: string;
  order_id?: string | null;
  status: string;
  amount: number;
  currency: string;
}

/** The client's shape, so a test can substitute one without a mocking library. */
export interface RazorpayApi {
  createOrder(input: { amountPaise: number; receipt: string; notes?: Record<string, string> }): Promise<RazorpayOrder>;
  refund(input: { paymentId: string; amountPaise: number; notes?: Record<string, string> }): Promise<RazorpayRefund>;
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  /** Phase 8: what actually happened to an order whose webhook never arrived. */
  paymentsForOrder(orderId: string): Promise<RazorpayPayment[]>;
  /** Refunds already raised against a payment, so one is never raised twice. */
  refundsForPayment(paymentId: string): Promise<RazorpayRefund[]>;
}

@Injectable()
export class RazorpayClient implements RazorpayApi {
  private readonly config: Env;

  constructor(config: Env = env()) {
    this.config = config;
  }

  get keyId(): string {
    return this.config.RAZORPAY_KEY_ID;
  }

  get configured(): boolean {
    return paymentsConfigured(this.config);
  }

  /**
   * An order for `amountPaise`, which the CALLER derived from the session fee.
   *
   * This method has no idea what anything costs, and that is intentional: an amount
   * argument that could ever originate from a request body is the single most
   * exploitable payment bug there is (docs/Rules.md 9). The one place the fee is read
   * is the join command, from the locked session row.
   */
  async createOrder(input: {
    amountPaise: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<RazorpayOrder> {
    const body = await this.post<RazorpayOrder>('/orders', {
      amount: input.amountPaise,
      currency: 'INR',
      // Our queue-entry id. Razorpay echoes it back on every event and on the
      // dashboard, which is what lets Phase 8's reconcile worker match an orphaned
      // order to the reservation it belongs to.
      receipt: input.receipt,
      notes: input.notes ?? {},
    });
    return { id: body.id, amount: body.amount, currency: body.currency };
  }

  /**
   * Raise a refund. **Asynchronous**: a 200 here means Razorpay accepted the
   * request, not that the patient has their money - settlement arrives later as
   * `refund.processed` (docs/Phases.md Phase 5 risks).
   */
  async refund(input: {
    paymentId: string;
    amountPaise: number;
    notes?: Record<string, string>;
  }): Promise<RazorpayRefund> {
    const body = await this.post<RazorpayRefund>(`/payments/${input.paymentId}/refund`, {
      amount: input.amountPaise,
      notes: input.notes ?? {},
    });
    return { id: body.id, amount: body.amount, status: body.status };
  }

  /**
   * Is this webhook really from Razorpay?
   *
   * HMAC-SHA256 of the RAW body under the webhook secret, hex-encoded, compared in
   * constant time. Three things here are load-bearing:
   *
   *   - **Raw bytes.** `JSON.parse` then `JSON.stringify` reorders nothing but
   *     re-encodes everything, and the digest changes. This takes a Buffer so it
   *     cannot accidentally be handed a parsed object.
   *   - **`timingSafeEqual`.** A `===` on the hex string leaks the correct prefix
   *     through timing, and a webhook endpoint can be probed as often as an attacker
   *     likes.
   *   - **The length guard.** `timingSafeEqual` THROWS on unequal lengths, so a
   *     garbage signature would become a 500 rather than a rejection.
   *
   * Returns false rather than throwing: an unverified webhook is not an exception,
   * it is a stranger, and the caller answers it accordingly.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    const secret = this.config.RAZORPAY_WEBHOOK_SECRET;
    if (secret === '' || signature === undefined || signature === '') {
      return false;
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest();
    // Buffer.from(..., 'hex') truncates at the first invalid pair rather than
    // throwing, so the length comparison is what rejects a malformed signature.
    const provided = Buffer.from(signature, 'hex');
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(expected, provided);
  }

  /**
   * P8-BE-05 · every payment Razorpay knows about for one of our orders.
   *
   * The webhook is the primary path and always will be - this exists because
   * webhooks are delivered over the internet to a server that might have been
   * restarting, and docs/Architecture.md 12 budgets for exactly that: *"catch missed
   * webhooks by polling Razorpay."* A patient whose money left their account must get
   * a token whether or not an HTTP callback survived the journey.
   */
  async paymentsForOrder(orderId: string): Promise<RazorpayPayment[]> {
    const body = await this.get<{ items?: RazorpayPayment[] }>(`/orders/${orderId}/payments`);
    return body.items ?? [];
  }

  /**
   * Every refund Razorpay holds against this payment.
   *
   * Asked BEFORE re-sending a refund that our own records show as unsent. Raising a
   * refund is not idempotent - two POSTs are two refunds - and the failure this
   * guards against is the narrow one where the gateway accepted the request and the
   * write recording its id did not land. Matching on our `refundId` in `notes`
   * distinguishes "we already paid this" from "we never did", and getting that wrong
   * gives a patient their money twice.
   */
  async refundsForPayment(paymentId: string): Promise<RazorpayRefund[]> {
    const body = await this.get<{ items?: RazorpayRefund[] }>(`/payments/${paymentId}/refunds`);
    return body.items ?? [];
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'GET',
      headers: { authorization: `Basic ${this.credentials()}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Razorpay ${path} failed with ${res.status}: ${detail.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  private credentials(): string {
    return Buffer.from(
      `${this.config.RAZORPAY_KEY_ID}:${this.config.RAZORPAY_KEY_SECRET}`,
    ).toString('base64');
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${this.credentials()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Razorpay's error body is safe to log but not to return: it can name internal
      // fields. The filter turns this into INTERNAL_ERROR with a generic message,
      // and pino keeps the detail (docs/Rules.md 7).
      const detail = await res.text().catch(() => '');
      throw new Error(`Razorpay ${path} failed with ${res.status}: ${detail.slice(0, 500)}`);
    }

    return (await res.json()) as T;
  }
}
