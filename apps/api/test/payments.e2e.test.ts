import { createHmac } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, request, resetDb, signup } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeRazorpay, WEBHOOK_SECRET } from './razorpay.fake';
import { RazorpayClient } from '../src/modules/payments/razorpay.client';
import { ReservationSweeper } from '../src/modules/queue/reservation-sweeper';
import { QueuePolicyService } from '../src/modules/config/queue-policy.service';
import { dateColumnFromString, istToday } from '../src/common/ist';

/**
 * P5-BE-01..04 done-when, against a real Postgres.
 *
 * **Razorpay is the only thing faked, and its signature check is real.** The fake
 * computes the same HMAC the client does, so "bad signature rejected" is testing the
 * actual verification rather than a stub that returns whatever the test wants. The
 * database, both guards, the state machine and the session lock are all the real
 * ones - they are what these tests are about.
 */

const FEE_PAISE = 50_000;

describe('join -> pay -> token (Phase 5)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let razorpay: FakeRazorpay;
  let sweeper: ReservationSweeper;

  let hospitalId: string;
  let sessionId: string;
  let departmentId: string;
  let accessToken: string;
  let patientId: string;

  const capturedBody = (orderId: string, paymentId: string, amount = FEE_PAISE) =>
    JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: 'INR', status: 'captured' } } },
    });

  const postWebhook = (body: string, signature?: string) =>
    request(app.getHttpServer())
      .post('/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', signature ?? createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(body)).digest('hex'))
      .send(body);

  /**
   * The QueuePolicy row is created lazily on first use, so an `updateMany` before
   * any command has run matches ZERO rows and silently does nothing - which is how
   * the first version of this test "passed" a cap that was never set. Going through
   * the service creates it with the real defaults first.
   */
  const capOnlineTokensAt = async (maxOnlineTokens: number) => {
    await app.get(QueuePolicyService).ensure(hospitalId);
    const updated = await prisma.queuePolicy.updateMany({ where: { hospitalId }, data: { maxOnlineTokens } });
    expect(updated.count).toBe(1);
  };

  const join = () =>
    request(app.getHttpServer())
      .post(`/sessions/${sessionId}/join`)
      .set(auth(accessToken))
      .send({ patientId });

  beforeAll(async () => {
    razorpay = new FakeRazorpay();
    ({ app, prisma } = await createTestApp([{ provide: RazorpayClient, useValue: razorpay }]));
    sweeper = app.get(ReservationSweeper);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    razorpay.orders = [];
    razorpay.refunds = [];

    hospitalId = (await prisma.hospital.create({ data: { name: 'Pay Test', city: 'Pune', status: 'VERIFIED' } })).id;
    departmentId = (await prisma.department.create({ data: { hospitalId, name: 'ENT' } })).id;
    const doctorId = (await prisma.doctor.create({ data: { hospitalId, departmentId, name: 'Dr Pay' } })).id;

    const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
    sessionId = (
      await prisma.oPDSession.create({
        data: {
          hospitalId,
          departmentId,
          originalDoctorId: doctorId,
          currentProviderDoctorId: doctorId,
          // istToday(), NOT toISOString().slice(0,10): the second is the UTC day, and
          // between 00:00 and 05:30 IST that is YESTERDAY. Every fixture here stamped
          // sessions with the wrong calendar date for five and a half hours a day, so
          // discovery - which filters on the IST day - returned nothing and the suite
          // failed only if you happened to run it after midnight.
          date: dateColumnFromString(istToday()),
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + 3 * 60 * 60 * 1000),
          feePaise: FEE_PAISE,
          status: 'OPEN_FOR_REGISTRATION',
        },
      })
    ).id;

    const account = await signup(app, `patient-${Date.now()}@test.dev`);
    accessToken = account.accessToken;
    patientId = (
      await prisma.patient.create({ data: { accountId: account.accountId, name: 'Asha', relation: 'SELF' } })
    ).id;
  });

  // -------------------------------------------------------------------------

  it('reserves a place without taking money, and derives the amount from the session', async () => {
    const res = await join().expect(201);

    expect(res.body.entry.status).toBe('RESERVED');
    // The fee came from the session row. The request body contained no amount at
    // all, which is the point (docs/Rules.md 9).
    expect(res.body.amountPaise).toBe(FEE_PAISE);
    expect(res.body.entry.feePaise).toBe(FEE_PAISE);
    expect(razorpay.orders[0]?.amount).toBe(FEE_PAISE);
    // No token is usable yet: nothing to check in with until it is paid for.
    expect(res.body.entry.checkInCode).toBeNull();
    expect(res.body.entry.reservationExpiresAt).not.toBeNull();

    const payment = await prisma.payment.findUniqueOrThrow({ where: { queueEntryId: res.body.entry.id } });
    expect(payment.status).toBe('CREATED');
    expect(payment.amountPaise).toBe(FEE_PAISE);
  });

  it('ignores an amount the client tries to send', async () => {
    // A client that could name its own price is the most exploitable payment bug
    // there is. `JoinRequest` has no amount field and Zod strips unknown keys, so
    // these never reach any code that could read them.
    //
    // Asserting the ORDER rather than a 400 is deliberate: a 400 would only prove
    // the request was malformed, where this proves the one-paise value was ignored
    // and the session fee was charged instead. That is the property that matters.
    const res = await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/join`)
      .set(auth(accessToken))
      .send({ patientId, amountPaise: 1, feePaise: 1 })
      .expect(201);

    expect(res.body.amountPaise).toBe(FEE_PAISE);
    expect(razorpay.orders[0]?.amount).toBe(FEE_PAISE);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { queueEntryId: res.body.entry.id } });
    expect(payment.amountPaise).toBe(FEE_PAISE);
  });

  it('issues the token only from a signature-verified webhook', async () => {
    const joined = (await join().expect(201)).body;

    // Before the webhook: still a hold, still no token to scan.
    let entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: joined.entry.id } });
    expect(entry.status).toBe('RESERVED');

    const ack = await postWebhook(capturedBody(joined.razorpayOrderId, 'pay_1')).expect(201);
    expect(ack.body.handled).toBe('CONFIRMED');

    entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: joined.entry.id } });
    expect(entry.status).toBe('CONFIRMED');
    expect(entry.checkInCode).not.toBeNull();
    expect(entry.reservationExpiresAt).toBeNull();

    const payment = await prisma.payment.findUniqueOrThrow({ where: { queueEntryId: joined.entry.id } });
    expect(payment.status).toBe('SUCCESS');
    expect(payment.razorpayPaymentId).toBe('pay_1');
  });

  it('rejects a forged webhook and issues nothing', async () => {
    const joined = (await join().expect(201)).body;

    await postWebhook(capturedBody(joined.razorpayOrderId, 'pay_forged'), 'deadbeef').expect(400);
    await postWebhook(capturedBody(joined.razorpayOrderId, 'pay_forged'), undefined as unknown as string)
      .set('x-razorpay-signature', '')
      .expect(400);

    const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: joined.entry.id } });
    expect(entry.status).toBe('RESERVED');
    expect(entry.checkInCode).toBeNull();
  });

  it('treats a replayed webhook as a no-op - never a second token, never an error', async () => {
    const joined = (await join().expect(201)).body;
    const body = capturedBody(joined.razorpayOrderId, 'pay_replay');

    const first = await postWebhook(body).expect(201);
    expect(first.body.handled).toBe('CONFIRMED');

    // Razorpay retries. Three more times, byte-identical.
    for (const _ of [1, 2, 3]) {
      const again = await postWebhook(body).expect(201);
      // 2xx matters more than the word: a non-2xx here starts a retry storm.
      expect(again.body.handled).toBe('DUPLICATE');
    }

    const entries = await prisma.queueEntry.findMany({ where: { sessionId } });
    expect(entries).toHaveLength(1);
    const payments = await prisma.payment.findMany({ where: { queueEntryId: joined.entry.id } });
    expect(payments).toHaveLength(1);

    // And exactly one confirmation on the timeline, not four.
    const confirmed = await prisma.queueEvent.count({ where: { sessionId, type: 'ENTRY_CONFIRMED' } });
    expect(confirmed).toBe(1);
  });

  it('resumes an unpaid hold instead of charging twice when join is retried', async () => {
    const first = (await join().expect(201)).body;
    const second = (await join().expect(201)).body;

    expect(second.entry.id).toBe(first.entry.id);
    expect(second.razorpayOrderId).toBe(first.razorpayOrderId);
    // One order, one reservation, one token number - however many times they tapped.
    expect(razorpay.orders).toHaveLength(1);
    expect(await prisma.queueEntry.count({ where: { sessionId } })).toBe(1);
  });

  it('refuses a second booking for a patient who has already paid', async () => {
    const joined = (await join().expect(201)).body;
    await postWebhook(capturedBody(joined.razorpayOrderId, 'pay_2')).expect(201);

    const res = await join().expect(409);
    expect(res.body.error.code).toBe('ALREADY_IN_QUEUE');
  });

  it('will not let one account book with another account\'s patient', async () => {
    const stranger = await signup(app, `stranger-${Date.now()}@test.dev`);
    const res = await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/join`)
      .set(auth(stranger.accessToken))
      .send({ patientId })
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await prisma.queueEntry.count({ where: { sessionId } })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Reservation expiry
  // -------------------------------------------------------------------------

  it('releases an unpaid hold and leaves a paid one alone', async () => {
    const unpaid = (await join().expect(201)).body;

    // A second patient, who pays.
    const other = await signup(app, `paid-${Date.now()}@test.dev`);
    const otherPatient = await prisma.patient.create({
      data: { accountId: other.accountId, name: 'Bala', relation: 'SELF' },
    });
    const paid = (
      await request(app.getHttpServer())
        .post(`/sessions/${sessionId}/join`)
        .set(auth(other.accessToken))
        .send({ patientId: otherPatient.id })
        .expect(201)
    ).body;
    await postWebhook(capturedBody(paid.razorpayOrderId, 'pay_kept')).expect(201);

    // Wind both holds into the past; only one of them is still unpaid.
    await prisma.queueEntry.updateMany({
      where: { sessionId },
      data: { reservationExpiresAt: new Date(Date.now() - 60_000) },
    });

    expect(await sweeper.expire()).toBe(1);

    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: unpaid.entry.id } })).status).toBe('CANCELLED');
    // docs/Rules.md 9: "releasing a slot must not affect a paid entry".
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: paid.entry.id } })).status).toBe('CONFIRMED');
  });

  it('gives the slot back when a payment lands after the hold expired', async () => {
    // The race docs/Phases.md says to decide now and test: the webhook wins.
    const joined = (await join().expect(201)).body;
    await prisma.queueEntry.update({
      where: { id: joined.entry.id },
      data: { reservationExpiresAt: new Date(Date.now() - 60_000) },
    });
    await sweeper.expire();
    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: joined.entry.id } })).status).toBe('CANCELLED');

    const ack = await postWebhook(capturedBody(joined.razorpayOrderId, 'pay_late')).expect(201);
    expect(ack.body.handled).toBe('REINSTATED');

    const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: joined.entry.id } });
    expect(entry.status).toBe('CONFIRMED');
    // Their original token number, because it was never handed to anyone else.
    expect(entry.tokenNumber).toBe(joined.entry.tokenNumber);
    expect(razorpay.refunds).toHaveLength(0);
  });

  it('refunds instead of reinstating when the session is over', async () => {
    const joined = (await join().expect(201)).body;
    await prisma.oPDSession.update({ where: { id: sessionId }, data: { status: 'COMPLETED' } });

    const ack = await postWebhook(capturedBody(joined.razorpayOrderId, 'pay_toolate')).expect(201);
    expect(ack.body.handled).toBe('REFUND_UPDATED');

    // The money is on the books and then given back - never silently kept.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { queueEntryId: joined.entry.id } });
    expect(payment.razorpayPaymentId).toBe('pay_toolate');
    expect(payment.status).toBe('REFUNDED');
    expect(payment.refundedPaise).toBe(FEE_PAISE);
    expect(razorpay.refunds).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // My visits + cancel
  // -------------------------------------------------------------------------

  it('recovers the token after a crash, and shows nobody else', async () => {
    const joined = (await join().expect(201)).body;
    await postWebhook(capturedBody(joined.razorpayOrderId, 'pay_recover')).expect(201);

    const res = await request(app.getHttpServer())
      .get('/me/queue-entries?scope=active')
      .set(auth(accessToken))
      .expect(200);

    expect(res.body.total).toBe(1);
    expect(res.body.items[0].tokenLabel).toBe(joined.entry.tokenLabel);
    expect(res.body.items[0].checkInCode).not.toBeNull();
    expect(res.body.items[0].hospitalName).toBe('Pay Test');
    // Paginated like every list endpoint (docs/Rules.md 6).
    expect(res.body).toMatchObject({ limit: 20, offset: 0 });

    // A stranger's list is empty, not a 403 - they simply have no visits.
    const stranger = await signup(app, `nosy-${Date.now()}@test.dev`);
    const theirs = await request(app.getHttpServer())
      .get('/me/queue-entries')
      .set(auth(stranger.accessToken))
      .expect(200);
    expect(theirs.body.items).toEqual([]);
  });

  it('cancels with a full refund inside the free window', async () => {
    const joined = (await join().expect(201)).body;
    await postWebhook(capturedBody(joined.razorpayOrderId, 'pay_cancel')).expect(201);

    // Well clear of the 120-minute free-cancellation window. The fixture session
    // starts in exactly 120 minutes, which sat ON the boundary and made this a coin
    // flip decided by how long the test took to get here.
    // Both ends move: OPDSession has a `end_after_start` check constraint, so
    // pushing the start past the old end is rejected by the database.
    const start = new Date(Date.now() + 5 * 60 * 60 * 1000);
    await prisma.oPDSession.update({
      where: { id: sessionId },
      data: { scheduledStart: start, scheduledEnd: new Date(start.getTime() + 3 * 60 * 60 * 1000) },
    });

    const res = await request(app.getHttpServer())
      .post(`/queue-entries/${joined.entry.id}/cancel`)
      .set(auth(accessToken))
      .send({ reason: 'Cannot make it today' })
      .expect(201);

    expect(res.body.entry.status).toBe('CANCELLED');
    expect(res.body.refund.amountPaise).toBe(FEE_PAISE);
    expect(res.body.refund.status).toBe('PENDING');

    const payment = await prisma.payment.findUniqueOrThrow({ where: { queueEntryId: joined.entry.id } });
    expect(payment.status).toBe('REFUNDED');
    expect(razorpay.refunds[0]?.amount).toBe(FEE_PAISE);
  });

  it('refunds the late percentage when the free window has closed', async () => {
    // 30 minutes away, so the 120-minute free-cancellation window has closed and the
    // policy's 50% late tier applies.
    await prisma.oPDSession.update({
      where: { id: sessionId },
      data: { scheduledStart: new Date(Date.now() + 30 * 60 * 1000) },
    });

    const joined = (await join().expect(201)).body;
    await postWebhook(capturedBody(joined.razorpayOrderId, 'pay_late_cancel')).expect(201);

    const res = await request(app.getHttpServer())
      .post(`/queue-entries/${joined.entry.id}/cancel`)
      .set(auth(accessToken))
      .send({})
      .expect(201);

    expect(res.body.refund.amountPaise).toBe(FEE_PAISE / 2);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { queueEntryId: joined.entry.id } });
    expect(payment.status).toBe('PARTIALLY_REFUNDED');
    expect(payment.refundedPaise).toBe(FEE_PAISE / 2);
  });

  it('refunds ONCE however many times cancel is pressed', async () => {
    // The bug this pins: `refundable` was computed from a read taken OUTSIDE the
    // transaction, and the refund was written whether or not the cancellation
    // actually changed anything. A second tap found an already-CANCELLED entry,
    // no-opped the state change, and then wrote a SECOND refund row and called
    // Razorpay again - real money, twice, for one cancellation.
    const joined = (await join().expect(201)).body;
    await postWebhook(capturedBody(joined.razorpayOrderId, 'pay_double_cancel')).expect(201);

    const cancel = () =>
      request(app.getHttpServer())
        .post(`/queue-entries/${joined.entry.id}/cancel`)
        .set(auth(accessToken))
        .send({});

    // CONCURRENT, not sequential. A sequential second request re-reads the payment
    // and already sees it refunded, so it never exercised the race at all - the
    // first version of this test passed against the buggy code. Two in flight at
    // once is the real double-tap: both read the payment as SUCCESS before either
    // has committed.
    const [a, b, c] = await Promise.all([cancel(), cancel(), cancel()]);
    for (const res of [a, b, c]) {
      // Still 2xx - cancelling an already-cancelled booking is not an error.
      expect(res.status).toBe(201);
      expect(res.body.entry.status).toBe('CANCELLED');
    }
    // Exactly one of them raised the refund.
    expect([a, b, c].filter((res) => res.body.refund !== null)).toHaveLength(1);

    const refunds = await prisma.refund.findMany({ where: { hospitalId } });
    expect(refunds).toHaveLength(1);
    expect(razorpay.refunds).toHaveLength(1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { queueEntryId: joined.entry.id } });
    // Never more than what was paid, whatever the tier.
    expect(payment.refundedPaise).toBeLessThanOrEqual(payment.amountPaise);
    expect(payment.refundedPaise).toBe(refunds[0]!.amountPaise);

    // And exactly one cancellation on the timeline, not three.
    const events = await prisma.queueEvent.count({ where: { sessionId, type: 'ENTRY_CANCELLED' } });
    expect(events).toBe(1);
  });

  it('does not create a QueuePolicy row just because a patient browsed', async () => {
    // discovery is a read-only projection (docs/PROGRESS.md). It reads the policy for
    // the registration cutoff, and reading must not INSERT - `ensure` creates on
    // first use, so a stranger browsing a hospital was writing to its config.
    await prisma.queuePolicy.deleteMany({ where: { hospitalId } });

    const cards = await request(app.getHttpServer())
      .get(`/departments/${departmentId}/sessions?limit=5`)
      .set(auth(accessToken))
      .expect(200);
    // Still answers correctly, using the defaults.
    expect(cards.body.items.length).toBeGreaterThan(0);
    expect(cards.body.items[0].snapshot.registrationOpen).toBe(true);

    await request(app.getHttpServer()).get(`/sessions/${sessionId}`).set(auth(accessToken)).expect(200);

    expect(await prisma.queuePolicy.count({ where: { hospitalId } })).toBe(0);
  });

  it('will not let one patient cancel another\'s booking', async () => {
    const joined = (await join().expect(201)).body;
    const stranger = await signup(app, `thief-${Date.now()}@test.dev`);

    await request(app.getHttpServer())
      .post(`/queue-entries/${joined.entry.id}/cancel`)
      .set(auth(stranger.accessToken))
      .send({})
      .expect(404);

    expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: joined.entry.id } })).status).toBe('RESERVED');
  });

  it('needs a signed-in account to join at all', async () => {
    await request(app.getHttpServer()).post(`/sessions/${sessionId}/join`).send({ patientId }).expect(401);
  });

  // -------------------------------------------------------------------------
  // Registration limits (docs/PRD.md 8.12)
  // -------------------------------------------------------------------------

  it('stops taking bookings once the online token cap is reached', async () => {
    await capOnlineTokensAt(1);
    await join().expect(201);

    const other = await signup(app, `capped-${Date.now()}@test.dev`);
    const otherPatient = await prisma.patient.create({
      data: { accountId: other.accountId, name: 'Chandra', relation: 'SELF' },
    });
    const res = await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/join`)
      .set(auth(other.accessToken))
      .send({ patientId: otherPatient.id })
      .expect(409);

    expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
    expect(res.body.error.details.reason).toBe('TOKEN_CAP_REACHED');
  });

  it('frees the capped slot again once the unpaid hold lapses', async () => {
    await capOnlineTokensAt(1);
    const first = (await join().expect(201)).body;

    // The column is what frees the slot - no sweeper has run here on purpose.
    await prisma.queueEntry.update({
      where: { id: first.entry.id },
      data: { reservationExpiresAt: new Date(Date.now() - 1000) },
    });

    const other = await signup(app, `second-${Date.now()}@test.dev`);
    const otherPatient = await prisma.patient.create({
      data: { accountId: other.accountId, name: 'Divya', relation: 'SELF' },
    });
    await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/join`)
      .set(auth(other.accessToken))
      .send({ patientId: otherPatient.id })
      .expect(201);
  });

  it('refuses a join once staff have closed registration', async () => {
    await prisma.oPDSession.update({ where: { id: sessionId }, data: { registrationClosedAt: new Date() } });
    const res = await join().expect(409);
    expect(res.body.error.details.reason).toBe('MANUALLY_CLOSED');
  });
});
