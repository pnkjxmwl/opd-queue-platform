import { Injectable } from '@nestjs/common';
import { Sweeper } from '../../common/sweeper';
import { PaymentsService } from './payments.service';

/**
 * P8-BE-05 · the safety net under the webhook (docs/Architecture.md 12).
 *
 * Webhooks cross the internet to a server that might have been restarting, mid-deploy
 * or briefly unreachable. Everything else in the product tolerates a lost message by
 * re-reading; a lost `payment.captured` does not, because the money has already left
 * the patient's account and only that callback was going to turn it into a token.
 *
 * So this asks Razorpay directly about anything still unconfirmed, and hands the
 * answer to the SAME function the webhook calls.
 */

/** Five minutes: long past a UPI round trip, well inside the reservation window. */
const INTERVAL_MS = 5 * 60_000;

/**
 * How stale a pending payment must be before it is worth asking about. Comfortably
 * longer than a slow checkout, so a patient still typing their PIN is not chased.
 */
const STALE_AFTER_MS = 3 * 60_000;

@Injectable()
export class ReconcileSweeper extends Sweeper {
  protected readonly name = 'reconcile';
  protected readonly intervalMs = INTERVAL_MS;

  constructor(private readonly payments: PaymentsService) {
    super();
  }

  protected async sweep(): Promise<void> {
    const stale = new Date(Date.now() - STALE_AFTER_MS);

    const { checked, confirmed } = await this.payments.reconcilePending(stale);
    if (confirmed > 0) this.log.warn(`reconciled ${confirmed} of ${checked} pending payments`);

    // Money owed OUT, which had no safety net at all until the pre-production audit:
    // a refund whose gateway call failed was left PENDING forever, with the payment
    // row already saying REFUNDED. The books said the patient had been paid.
    const refunds = await this.payments.reconcileRefunds(stale);
    if (refunds.sent + refunds.adopted > 0) {
      this.log.warn(
        `re-sent ${refunds.sent} and adopted ${refunds.adopted} of ${refunds.checked} stranded refunds`,
      );
    }
  }
}
