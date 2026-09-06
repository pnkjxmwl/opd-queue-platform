import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, request, resetDb, signup } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { GraceSweeper } from '../src/modules/queue/grace-sweeper';
import { CutoffSweeper } from '../src/modules/queue/cutoff-sweeper';
import { ReservationSweeper } from '../src/modules/queue/reservation-sweeper';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { ReconcileSweeper } from '../src/modules/payments/reconcile-sweeper';
import { RazorpayClient } from '../src/modules/payments/razorpay.client';
import { DispatchSweeper } from '../src/modules/notifications/dispatch-sweeper';
import { EventNotifier } from '../src/modules/notifications/event-notifier';
import { LeaveNowNotifier } from '../src/modules/notifications/leave-now';
import { EtaTick } from '../src/modules/eta/eta-tick';
import { Sweeper } from '../src/common/sweeper';
import { dateColumnFromString, istToday } from '../src/common/ist';
import { QueuePolicyService } from '../src/modules/config/queue-policy.service';

/**
 * P8-BE-03/04/05 · the timers, run deliberately rather than waited for.
 *
 * Each sweeper exposes its one pass as a method, so these tests drive the clock by
 * writing timestamps rather than by sleeping. That is the whole reason the workers
 * are sweeps over state: "has the grace period expired" is a question about a column,
 * so a test can answer it by setting the column.
 *
 * The claim underneath all of them is docs/Phases.md's rule for this phase, and it is
 * asserted directly: **a worker changes state only through domain commands**, so the
 * audit log and the queue timeline record a timer's action exactly as they record a
 * receptionist's.
 */

const fakeRazorpay = {
  configured: true,
  createOrder: async () => ({ id: 'order_test', amount: 0, currency: 'INR' }),
  refund: async (input: { amountPaise: number }) => ({
    id: `rfnd_${input.amountPaise}`,
    status: 'processed',
  }),
  verifyWebhookSignature: () => true,
  // Set per test: what Razorpay says happened to an order nobody told us about.
  paymentsForOrder: async (): Promise<
    { id: string; order_id?: string | null; status: string; amount: number; currency: string }[]
  > => [],
  // Set per test: refunds the gateway already holds against a payment. An empty
  // list means "never sent", which is what makes the reconciler re-send.
  refundsForPayment: async (): Promise<
    { id: string; amount: number; status: string; notes?: Record<string, string> | null }[]
  > => [],
};

describe('background workers (P8-BE-03, P8-BE-04, P8-BE-05)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let hospitalId: string;
  let departmentId: string;
  let doctorId: string;
  let sessionId: string;
  let staff: Awaited<ReturnType<typeof signup>>;
  let patientAccountId: string;

  const http = () => request(app.getHttpServer());

  async function book(name: string, tokenNumber: number, status: 'CONFIRMED' | 'CHECKED_IN') {
    const person = await prisma.patient.create({ data: { name, accountId: patientAccountId } });
    return prisma.queueEntry.create({
      data: {
        hospitalId,
        sessionId,
        patientId: person.id,
        accountId: patientAccountId,
        tokenNumber,
        tokenLabel: `A${String(tokenNumber).padStart(3, '0')}`,
        type: 'ONLINE',
        status,
        checkInCode: `worker-ref-${tokenNumber}-000000`,
      },
    });
  }

  /** `ensure` creates the row with this hospital's defaults; then edit it. */
  async function setPolicy(data: Record<string, unknown>): Promise<void> {
    await app.get(QueuePolicyService).ensure(hospitalId);
    await prisma.queuePolicy.update({ where: { hospitalId }, data });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp([
      { provide: RazorpayClient, useValue: fakeRazorpay },
    ]));
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(prisma);
    fakeRazorpay.paymentsForOrder = async () => [];
    fakeRazorpay.refundsForPayment = async () => [];

    hospitalId = (
      await prisma.hospital.create({
        data: { name: 'Worker Hospital', city: 'Mumbai', status: 'VERIFIED' },
      })
    ).id;
    departmentId = (await prisma.department.create({ data: { hospitalId, name: 'Cardiology' } })).id;
    doctorId = (
      await prisma.doctor.create({
        data: { hospitalId, departmentId, name: 'Dr Timer', defaultConsultMins: 10 },
      })
    ).id;

    const start = new Date(Date.now() - 60 * 60_000);
    sessionId = (
      await prisma.oPDSession.create({
        data: {
          hospitalId,
          departmentId,
          originalDoctorId: doctorId,
          currentProviderDoctorId: doctorId,
          date: dateColumnFromString(istToday()),
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + 5 * 60 * 60 * 1000),
          feePaise: 50_000,
          status: 'ACTIVE',
          // The grace-expiry block calls patients, and call-next is refused while the
          // doctor is NOT_PRESENT - which is the column default.
          doctorPresence: 'PRESENT',
        },
      })
    ).id;

    staff = await signup(app, 'staff@worker.test');
    patientAccountId = (await signup(app, 'patient@worker.test')).accountId;
    await prisma.hospitalStaff.create({
      data: { hospitalId, accountId: staff.accountId, role: 'RECEPTION' },
    });
    // The row is created on first use by QueuePolicyService.ensure, which every
    // command calls - so it exists by the time any sweeper reads it.
    await app.get(QueuePolicyService).ensure(hospitalId);
  });

  // =========================================================================
  // Grace expiry
  // =========================================================================

  describe('grace expiry (P8-BE-03)', () => {
    const sweeper = () => app.get(GraceSweeper);

    /** Call the front of the queue and pretend the grace period has run out. */
    async function callAndAge(): Promise<string> {
      await http().post(`/sessions/${sessionId}/call-next`).set(auth(staff.accessToken)).send({}).expect(201);
      const called = await prisma.queueEntry.findFirstOrThrow({ where: { status: 'CALLED' } });
      await prisma.queueEntry.update({
        where: { id: called.id },
        data: { calledAt: new Date(Date.now() - 60 * 60_000) },
      });
      return called.id;
    }

    it('leaves a patient alone while their grace period is still running', async () => {
      await book('Punctual', 1, 'CHECKED_IN');
      await http().post(`/sessions/${sessionId}/call-next`).set(auth(staff.accessToken)).send({}).expect(201);

      expect(await sweeper().expireGrace()).toEqual([]);
      const entry = await prisma.queueEntry.findFirstOrThrow({});
      expect(entry.status).toBe('CALLED');
    });

    it('passes over a patient who did not appear, and puts them back in the queue', async () => {
      await setPolicy({ recallAttempts: 2 });
      await book('Absent', 1, 'CHECKED_IN');
      const entryId = await callAndAge();

      expect(await sweeper().expireGrace()).toEqual([entryId]);

      const entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } });
      // Back in the pool for another go, with the recall spent and recorded.
      expect(entry.status).toBe('CHECKED_IN');
      expect(entry.recallCount).toBe(1);
      expect(entry.requeuedAt).not.toBeNull();
    });

    it('gives up once the hospital says the recalls are spent', async () => {
      await setPolicy({ recallAttempts: 1 });
      await book('Absent', 1, 'CHECKED_IN');
      const entryId = await callAndAge();

      await sweeper().expireGrace();
      expect(
        (await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } })).status,
      ).toBe('NO_SHOW');
    });

    it('reads the threshold from the hospital, never from a constant', async () => {
      // An hour of grace: the same aged entry that was passed over above is now
      // still comfortably inside its window.
      await setPolicy({ gracePeriodSec: 7200 });
      await book('Absent', 1, 'CHECKED_IN');
      await callAndAge();

      expect(await sweeper().expireGrace()).toEqual([]);
    });

    it('writes the audit trail and the timeline, because it used the commands', async () => {
      await setPolicy({ recallAttempts: 2 });
      await book('Absent', 1, 'CHECKED_IN');
      const entryId = await callAndAge();
      await sweeper().expireGrace();

      const events = await prisma.queueEvent.findMany({ where: { entryId } });
      expect(events.map((e) => e.type)).toEqual(
        expect.arrayContaining(['ENTRY_CALLED', 'ENTRY_SKIPPED', 'ENTRY_REQUEUED']),
      );

      const audit = await prisma.auditLog.findFirst({
        where: { entityId: entryId, action: 'queue.SKIP' },
      });
      // A clock did this, and the record says so rather than blaming a person.
      expect(audit?.actorType).toBe('SYSTEM');
    });

    it('does nothing on a paused queue - the doctor is not there to be waited for', async () => {
      await book('Absent', 1, 'CHECKED_IN');
      await callAndAge();
      await prisma.oPDSession.update({ where: { id: sessionId }, data: { pausedAt: new Date() } });

      expect(await sweeper().expireGrace()).toEqual([]);
    });

    it('is safe to run twice in a row', async () => {
      await setPolicy({ recallAttempts: 2 });
      await book('Absent', 1, 'CHECKED_IN');
      const entryId = await callAndAge();

      await sweeper().expireGrace();
      await sweeper().expireGrace();

      // Not called again by the sweep, so not skipped twice either.
      expect(
        (await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } })).recallCount,
      ).toBe(1);
    });
  });

  // =========================================================================
  // Registration cutoff
  // =========================================================================

  describe('registration cutoff (P8-BE-04)', () => {
    const sweeper = () => app.get(CutoffSweeper);

    /** Enough people waiting that a newcomer could not be seen before the end. */
    async function fillQueue(count: number): Promise<void> {
      const person = await prisma.patient.create({ data: { name: 'Waiting' } });
      await prisma.queueEntry.createMany({
        data: Array.from({ length: count }, (_, i) => ({
          hospitalId,
          sessionId,
          patientId: person.id,
          tokenNumber: 500 + i,
          tokenLabel: `A${500 + i}`,
          type: 'WALK_IN' as const,
          status: 'CHECKED_IN' as const,
        })),
      });
    }

    it('leaves a session alone while the queue still fits in the day', async () => {
      await fillQueue(2);
      expect(await sweeper().closeOverrunSessions()).toEqual([]);
    });

    it('closes the doors when a newcomer could not be seen before the end', async () => {
      // Ten minutes left, twelve people waiting at ten minutes each.
      await prisma.oPDSession.update({
        where: { id: sessionId },
        data: { scheduledEnd: new Date(Date.now() + 10 * 60_000) },
      });
      await fillQueue(12);

      expect(await sweeper().closeOverrunSessions()).toEqual([sessionId]);
      expect(
        (await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } }))
          .registrationClosedAt,
      ).not.toBeNull();
    });

    it('records WHY, on the timeline and in the audit log', async () => {
      await prisma.oPDSession.update({
        where: { id: sessionId },
        data: { scheduledEnd: new Date(Date.now() + 10 * 60_000) },
      });
      await fillQueue(12);
      await sweeper().closeOverrunSessions();

      const event = await prisma.queueEvent.findFirstOrThrow({
        where: { sessionId, type: 'SESSION_REGISTRATION_CLOSED' },
      });
      expect(event.actorType).toBe('SYSTEM');
      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'queue.CLOSE_REGISTRATION' },
      });
      expect(audit.reason).toContain('would not be seen');
    });

    it('respects a hospital that would rather stay late', async () => {
      await setPolicy({ cutoffOnEtaOverrun: false });
      await prisma.oPDSession.update({
        where: { id: sessionId },
        data: { scheduledEnd: new Date(Date.now() + 10 * 60_000) },
      });
      await fillQueue(12);

      expect(await sweeper().closeOverrunSessions()).toEqual([]);
    });

    it('does not close the same session twice', async () => {
      await prisma.oPDSession.update({
        where: { id: sessionId },
        data: { scheduledEnd: new Date(Date.now() + 10 * 60_000) },
      });
      await fillQueue(12);

      await sweeper().closeOverrunSessions();
      expect(await sweeper().closeOverrunSessions()).toEqual([]);
      expect(
        await prisma.queueEvent.count({ where: { type: 'SESSION_REGISTRATION_CLOSED' } }),
      ).toBe(1);
    });

    it('stops the join it was closed to prevent', async () => {
      await prisma.oPDSession.update({
        where: { id: sessionId },
        data: { scheduledEnd: new Date(Date.now() + 10 * 60_000) },
      });
      await fillQueue(12);
      await sweeper().closeOverrunSessions();

      const patient = await signup(app, 'latecomer@worker.test');
      const person = await prisma.patient.create({
        data: { name: 'Latecomer', accountId: patient.accountId },
      });
      await http()
        .post(`/sessions/${sessionId}/join`)
        .set(auth(patient.accessToken))
        .send({ patientId: person.id })
        .expect(409);
    });
  });

  // =========================================================================
  // Payment reconciliation
  // =========================================================================

  describe('payment reconcile (P8-BE-05)', () => {
    /** A reservation whose webhook never arrived. */
    async function abandonedHold(): Promise<{ entryId: string; paymentId: string }> {
      const entry = await book('Paid But Unconfirmed', 1, 'CONFIRMED');
      await prisma.queueEntry.update({
        where: { id: entry.id },
        data: { status: 'RESERVED', reservationExpiresAt: new Date(Date.now() + 600_000) },
      });
      const payment = await prisma.payment.create({
        data: {
          hospitalId,
          queueEntryId: entry.id,
          accountId: patientAccountId,
          razorpayOrderId: `order_${entry.id}`,
          amountPaise: 50_000,
          currency: 'INR',
          status: 'CREATED',
          createdAt: new Date(Date.now() - 30 * 60_000),
        },
      });
      return { entryId: entry.id, paymentId: payment.id };
    }

    it('leaves a payment alone while the patient may still be typing their PIN', async () => {
      await abandonedHold();
      // Anything newer than the cutoff is not stale yet.
      const result = await app
        .get(PaymentsService)
        .reconcilePending(new Date(Date.now() - 60 * 60_000));
      expect(result.checked).toBe(0);
    });

    it('confirms a payment whose webhook never arrived', async () => {
      const { entryId, paymentId } = await abandonedHold();
      fakeRazorpay.paymentsForOrder = async () => [
        {
          id: 'pay_reconciled_001',
          order_id: `order_${entryId}`,
          status: 'captured',
          amount: 50_000,
          currency: 'INR',
        },
      ];

      const result = await app.get(PaymentsService).reconcilePending(new Date());
      expect(result).toMatchObject({ checked: 1, confirmed: 1 });

      // The money moved, so the patient has a token - which is the whole point.
      expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } })).status).toBe(
        'CONFIRMED',
      );
      expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
        'SUCCESS',
      );
    });

    it('leaves an abandoned checkout alone - nobody paid', async () => {
      const { entryId } = await abandonedHold();
      fakeRazorpay.paymentsForOrder = async () => [
        {
          id: 'pay_failed_001',
          order_id: `order_${entryId}`,
          status: 'failed',
          amount: 50_000,
          currency: 'INR',
        },
      ];

      expect(await app.get(PaymentsService).reconcilePending(new Date())).toMatchObject({
        confirmed: 0,
      });
      expect((await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } })).status).toBe(
        'RESERVED',
      );
    });

    it('is safe to run twice - the second pass finds nothing to do', async () => {
      const { entryId } = await abandonedHold();
      fakeRazorpay.paymentsForOrder = async () => [
        {
          id: 'pay_reconciled_002',
          order_id: `order_${entryId}`,
          status: 'captured',
          amount: 50_000,
          currency: 'INR',
        },
      ];

      await app.get(PaymentsService).reconcilePending(new Date());
      const second = await app.get(PaymentsService).reconcilePending(new Date());

      expect(second.checked).toBe(0);
      // One token, one payment row, one confirmation on the timeline.
      expect(await prisma.queueEvent.count({ where: { type: 'ENTRY_CONFIRMED' } })).toBe(1);
    });

    it('survives a gateway that will not answer, and keeps going', async () => {
      await abandonedHold();
      fakeRazorpay.paymentsForOrder = async () => {
        throw new Error('razorpay unreachable');
      };

      // One unreachable order must not take the sweep down with it.
      expect(await app.get(PaymentsService).reconcilePending(new Date())).toMatchObject({
        checked: 1,
        confirmed: 0,
      });
    });
  });

  // -------------------------------------------------------------------------

  describe('refund reconcile', () => {
    /**
     * A refund we raised and never managed to send: PENDING, no gateway id.
     *
     * `sendRefundToGateway` swallows a gateway failure on purpose - the cancellation
     * has committed and is correct - so this is the state a timeout leaves behind.
     * Nothing swept it until the pre-production audit, so the payment row said
     * REFUNDED while the patient had been given nothing.
     */
    async function strandedRefund(): Promise<{ refundId: string; paymentId: string }> {
      const entry = await book('Owed A Refund', 1, 'CONFIRMED');
      const payment = await prisma.payment.create({
        data: {
          hospitalId,
          queueEntryId: entry.id,
          accountId: patientAccountId,
          razorpayOrderId: `order_${entry.id}`,
          razorpayPaymentId: `pay_${entry.id}`,
          amountPaise: 50_000,
          currency: 'INR',
          status: 'REFUNDED',
          refundedPaise: 50_000,
        },
      });
      const refund = await prisma.refund.create({
        data: {
          hospitalId,
          paymentId: payment.id,
          amountPaise: 50_000,
          status: 'PENDING',
          reason: 'patient cancelled',
          createdAt: new Date(Date.now() - 30 * 60_000),
        },
      });
      return { refundId: refund.id, paymentId: payment.id };
    }

    it('re-sends a refund the gateway never received', async () => {
      const { refundId } = await strandedRefund();
      fakeRazorpay.refundsForPayment = async () => [];

      expect(await app.get(PaymentsService).reconcileRefunds(new Date())).toMatchObject({
        checked: 1,
        sent: 1,
        adopted: 0,
      });
      expect(
        (await prisma.refund.findUniqueOrThrow({ where: { id: refundId } })).razorpayRefundId,
      ).not.toBeNull();
    });

    it('adopts a refund the gateway already accepted rather than paying twice', async () => {
      const { refundId } = await strandedRefund();
      // The narrow case this exists for: the POST succeeded and the write recording
      // its id did not. Re-sending here would give the patient their money twice,
      // which is worse than giving it to them late.
      fakeRazorpay.refundsForPayment = async () => [
        { id: 'rfnd_already_sent', amount: 50_000, status: 'processed', notes: { refundId } },
      ];

      expect(await app.get(PaymentsService).reconcileRefunds(new Date())).toMatchObject({
        checked: 1,
        sent: 0,
        adopted: 1,
      });
      expect(
        (await prisma.refund.findUniqueOrThrow({ where: { id: refundId } })).razorpayRefundId,
      ).toBe('rfnd_already_sent');
    });

    it('leaves a refund that already has a gateway id alone', async () => {
      const { refundId } = await strandedRefund();
      await prisma.refund.update({
        where: { id: refundId },
        data: { razorpayRefundId: 'rfnd_done' },
      });

      expect(await app.get(PaymentsService).reconcileRefunds(new Date())).toMatchObject({
        checked: 0,
      });
    });
  });

  // -------------------------------------------------------------------------

  describe('the DISABLED_WORKERS kill switch', () => {
    /**
     * Every background worker, and the name each answers to.
     *
     * This exists because the list in `config/env.ts` was wrong in both directions:
     * it advertised `reservation` and `eta-tick` as switches, and those two classes
     * predated `Sweeper` and hand-rolled their own timers without ever reading the
     * variable - so switching them off did nothing and looked exactly like success.
     * Meanwhile `dispatch` and `leave-now` worked and went unmentioned.
     *
     * A comment naming identifiers drifts. This is the same comment, executable.
     */
    it('is honoured by every worker, under the names the env doc advertises', () => {
      const workers = [
        CutoffSweeper,
        DispatchSweeper,
        EtaTick,
        EventNotifier,
        GraceSweeper,
        LeaveNowNotifier,
        ReconcileSweeper,
        ReservationSweeper,
      ];

      const names = workers.map((worker) => {
        const instance = app.get(worker);
        // Only `Sweeper` reads DISABLED_WORKERS, so being one IS honouring it.
        expect(instance, `${worker.name} must extend Sweeper`).toBeInstanceOf(Sweeper);
        return (instance as unknown as { name: string }).name;
      });

      expect(names.sort()).toEqual([
        'cutoff',
        'dispatch',
        'eta-tick',
        'grace',
        'leave-now',
        'notify',
        'reconcile',
        'reservation',
      ]);
    });
  });
});
