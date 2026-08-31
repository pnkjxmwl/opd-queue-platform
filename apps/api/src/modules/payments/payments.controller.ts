import { Body, Controller, Get, Header, Headers, Param, Post, Query, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  CancelEntryRequest,
  JoinRequest,
  MyQueueEntriesQuery,
  type CancelEntryResponse,
  type JoinResponse,
  type MyQueueEntry,
  type Paginated,
  type WebhookAck,
} from '@opd/contracts';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { CurrentAccount, Public } from '../../common/decorators';
import type { AuthedAccount } from '../../common/auth-context';
import { PaymentsService } from './payments.service';

/**
 * The patient's side of the queue (docs/Architecture.md 6.3).
 *
 * **Authenticated but NOT tenant-scoped, and that is expressed by `:id`.** A patient
 * has no `HospitalStaff` membership in the hospital they are booking at, so if this
 * route were `/sessions/:sessionId/join` the global `TenantGuard` would resolve the
 * hospital from the session and then reject every patient for having no membership.
 * Phase 4's command routes use `:sessionId` for exactly the opposite reason. The
 * parameter name is load-bearing (trap 12 in docs/PROGRESS.md), and
 * `payments.e2e.test.ts` guards it.
 *
 * The hospital is still never taken from the request: the service reads it from the
 * session row.
 */
@Controller()
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('sessions/:id/join')
  join(
    @Param('id') sessionId: string,
    @CurrentAccount() account: AuthedAccount,
    @Body(new ZodBody(JoinRequest)) body: JoinRequest,
  ): Promise<JoinResponse> {
    return this.payments.join(sessionId, account.id, body);
  }

  /**
   * Crash recovery (docs/Architecture.md 12 case B): the app was killed between
   * paying and seeing the token, so on relaunch it asks the server what it has.
   */
  @Get('me/queue-entries')
  myEntries(
    @CurrentAccount() account: AuthedAccount,
    @Query(new ZodBody(MyQueueEntriesQuery)) query: MyQueueEntriesQuery,
  ): Promise<Paginated<MyQueueEntry>> {
    return this.payments.myEntries(account.id, query);
  }

  @Post('queue-entries/:id/cancel')
  cancel(
    @Param('id') entryId: string,
    @CurrentAccount() account: AuthedAccount,
    @Body(new ZodBody(CancelEntryRequest)) body: CancelEntryRequest,
  ): Promise<CancelEntryResponse> {
    return this.payments.cancel(entryId, account.id, body);
  }
}

/**
 * Razorpay's callback.
 *
 * **`@Public()` is correct here and is the one place in this phase it is.** Razorpay
 * has no account and no JWT; the HMAC signature over the raw body IS the
 * authentication, and it is stronger than a bearer token because it also proves the
 * body was not altered. `@Public()` is greppable precisely so this decision is
 * visible rather than assumed.
 *
 * `req.rawBody` needs `NestFactory.create(..., { rawBody: true })` - see main.ts.
 * Without it the service throws rather than verifying a signature over a body that
 * was parsed and re-serialised, which would pass or fail for reasons unrelated to
 * authenticity.
 *
 * Rate limiting is Phase 9's list, and must never throttle legitimate Razorpay
 * retries (docs/Rules.md 10).
 */
@Controller('webhooks')
export class RazorpayWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * Where redirect-mode Checkout returns the browser.
   *
   * The app intercepts this URL and never loads it, so this page is the safety net
   * for the case where interception misses - a plain "you can close this" instead of
   * a browser error on a payment screen.
   *
   * It decides NOTHING. Razorpay appends payment ids to it and they are all ignored:
   * the token comes from the signature-verified webhook, and a query string is not a
   * signature (docs/Rules.md 9).
   */
  @Public()
  @Get('/checkout-complete')
  @Header('content-type', 'text/html; charset=utf-8')
  checkoutComplete(): string {
    return `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:system-ui;margin:0;display:grid;place-items:center;height:100vh;background:#F7FAFC;color:#0F172A">
<div style="text-align:center;padding:24px">
<h1 style="font-size:20px;margin:0 0 8px">Payment received</h1>
<p style="margin:0;color:#64748B">You can close this and return to the app.<br>Your token appears once we have confirmed it.</p>
</div></body>`;
  }

  @Public()
  @Post('razorpay')
  razorpay(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature?: string,
  ): Promise<WebhookAck> {
    return this.payments.handleWebhook(req.rawBody, signature);
  }
}
