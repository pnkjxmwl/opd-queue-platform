import { Module } from '@nestjs/common';
import {
  PaymentsController,
  RazorpayWebhookController,
  StaffCancellationController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { RazorpayClient } from './razorpay.client';
import { ReconcileSweeper } from './reconcile-sweeper';
import { QueueModule } from '../queue/queue.module';
import { ConfigModule } from '../config/config.module';
import { EtaModule } from '../eta/eta.module';

/**
 * Join, payment, refund (docs/Architecture.md 10). Owns `Payment` and `Refund`.
 *
 * It writes no `QueueEntry` of its own: every entry change goes through a Phase-4
 * domain command from QueueModule, so the state machine, the audit log and the
 * queue timeline apply to a payment exactly as they do to a receptionist's action
 * (docs/Rules.md 1.2). What it does write inside those commands is its OWN tables,
 * through the same transaction - which is what keeps a paid entry and its payment
 * record from ever disagreeing.
 */
@Module({
  // EtaModule fills etaFrom/etaTo on the patient's token card - through its
  // service, never by reading Consultation from here.
  imports: [QueueModule, ConfigModule, EtaModule],
  controllers: [PaymentsController, RazorpayWebhookController, StaffCancellationController],
  providers: [
    PaymentsService,
    ReconcileSweeper,
    // Constructed by hand, not by DI. RazorpayClient takes an optional `Env`, and
    // Nest reads that parameter as an injectable `Object` it cannot resolve - which
    // broke every OTHER e2e suite while the payment tests kept passing, because they
    // override this provider with a fake. A factory keeps the test seam without
    // asking the container to understand it.
    { provide: RazorpayClient, useFactory: () => new RazorpayClient() },
  ],
  exports: [PaymentsService, ReconcileSweeper],
})
export class PaymentsModule {}
