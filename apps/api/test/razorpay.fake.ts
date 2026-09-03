import { createHmac } from 'node:crypto';
import type { RazorpayApi } from '../src/modules/payments/razorpay.client';

/**
 * The one thing faked in the whole suite, because it is the one thing that would
 * otherwise take real money.
 *
 * It is a fake rather than a stub: `verifyWebhookSignature` computes the same HMAC
 * the real client does, so "a forged webhook is rejected" tests the actual
 * verification instead of a stand-in that returns whatever the test wants. The
 * database, both guards, the state machine and the session lock stay real - they are
 * what the tests are about.
 *
 * Lives here rather than inside one test file so a second suite can use it without
 * importing that file, which would silently run its describes as a side effect.
 */
export const WEBHOOK_SECRET = 'test-webhook-secret-value';

export class FakeRazorpay implements RazorpayApi {
  readonly keyId = 'rzp_test_fake';
  readonly configured = true;
  orders: { id: string; amount: number; receipt: string }[] = [];
  refunds: { id: string; paymentId: string; amount: number }[] = [];

  async createOrder(input: { amountPaise: number; receipt: string }) {
    const order = {
      id: `order_${this.orders.length + 1}`,
      amount: input.amountPaise,
      receipt: input.receipt,
    };
    this.orders.push(order);
    return { id: order.id, amount: order.amount, currency: 'INR' };
  }

  async refund(input: { paymentId: string; amountPaise: number }) {
    const refund = {
      id: `rfnd_${this.refunds.length + 1}`,
      paymentId: input.paymentId,
      amount: input.amountPaise,
    };
    this.refunds.push(refund);
    return { id: refund.id, amount: refund.amount, status: 'processed' };
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (signature === undefined) return false;
    const expected = createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
    return expected === signature;
  }
}

/** The body Razorpay sends on a successful capture. */
export const capturedWebhookBody = (
  orderId: string,
  paymentId: string,
  amountPaise: number,
): string =>
  JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: paymentId,
          order_id: orderId,
          amount: amountPaise,
          currency: 'INR',
          status: 'captured',
        },
      },
    },
  });

/** The signature header the real gateway would send for that body. */
export const signWebhook = (body: string): string =>
  createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(body)).digest('hex');
