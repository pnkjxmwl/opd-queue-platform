import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, request, resetDb, signup } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueService, type QueueActor } from '../src/modules/queue/queue.service';
import { RazorpayClient } from '../src/modules/payments/razorpay.client';
import { dateColumnFromString, istToday } from '../src/common/ist';
import { signCheckInCode } from '../src/common/checkin-code';
import { setPriority } from '../src/modules/queue/commands/priority';

/**
 * P6-BE-01 - what the consoles stand on.
 *
 * Three claims, and every one of them is something a screen would hide rather than
 * reveal: a forged QR is refused, the roster the doctor reads is in the SAME order
 * the engine will call people in, and a staff cancellation moves exactly as much
 * money as it says it does - once, even under a double-click.
 */

/** Razorpay is faked; nothing here is about the gateway. */
const fakeRazorpay = {
  configured: true,
  createOrder: async () => ({ id: 'order_test', amount: 0, currency: 'INR' }),
  refund: async (input: { amountPaise: number }) => ({
    id: `rfnd_${input.amountPaise}`,
    status: 'processed',
  }),
  verifyWebhookSignature: () => true,
};

describe('console reads + staff actions (P6-BE-01)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: QueueService;

  let hospitalId: string;
  let sessionId: string;
  let actor: QueueActor;
  let reception: Awaited<ReturnType<typeof signup>>;
  /** A DOCTOR *membership*. Not the Doctor row - beforeAll has its own `doctor` for that. */
  let doctorStaff: Awaited<ReturnType<typeof signup>>;
  let outsider: Awaited<ReturnType<typeof signup>>;
  /** The app account the booked patients belong to. `Payment.accountId` is required. */
  let patientAccountId: string;

  const http = () => request(app.getHttpServer());

  /** A paid booking, exactly as the webhook leaves one: CONFIRMED, with a code. */
  async function book(
    name: string,
    tokenNumber: number,
    opts: { paidPaise?: number } = {},
  ): Promise<{ entryId: string; reference: string }> {
    const patient = await prisma.patient.create({ data: { name, accountId: patientAccountId } });
    const reference = `ref-${tokenNumber}-${'x'.repeat(20)}`;
    const entry = await prisma.queueEntry.create({
      data: {
        hospitalId,
        sessionId,
        patientId: patient.id,
        accountId: patientAccountId,
        tokenNumber,
        tokenLabel: `A${String(tokenNumber).padStart(3, '0')}`,
        type: 'ONLINE',
        status: 'CONFIRMED',
        checkInCode: reference,
      },
    });

    if (opts.paidPaise !== undefined) {
      await prisma.payment.create({
        data: {
          hospitalId,
          queueEntryId: entry.id,
          accountId: patientAccountId,
          razorpayOrderId: `order_${entry.id}`,
          razorpayPaymentId: `pay_${entry.id}`,
          amountPaise: opts.paidPaise,
          currency: 'INR',
          status: 'SUCCESS',
        },
      });
    }
    return { entryId: entry.id, reference };
  }

  const statusOf = async (entryId: string) =>
    (await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } })).status;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp([{ provide: RazorpayClient, useValue: fakeRazorpay }]));
    queue = app.get(QueueService);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(prisma);

    const hospital = await prisma.hospital.create({
      data: { name: 'Console Hospital', city: 'Mumbai', status: 'VERIFIED' },
    });
    hospitalId = hospital.id;
    const department = await prisma.department.create({ data: { hospitalId, name: 'Cardiology' } });
    const doctor = await prisma.doctor.create({
      data: { hospitalId, departmentId: department.id, name: 'Dr Q' },
    });

    // Started two hours ago, so the free-cancellation window is comfortably past and
    // the PATIENT_REQUEST tier is the LATE one - which is the interesting case.
    const start = new Date(Date.now() - 2 * 60 * 60 * 1000);
    sessionId = (
      await prisma.oPDSession.create({
        data: {
          hospitalId,
          departmentId: department.id,
          originalDoctorId: doctor.id,
          currentProviderDoctorId: doctor.id,
          // istToday(), NOT toISOString().slice(0,10): the second is the UTC day, and
          // between 00:00 and 05:30 IST that is YESTERDAY. Every fixture here stamped
          // sessions with the wrong calendar date for five and a half hours a day, so
          // discovery - which filters on the IST day - returned nothing and the suite
          // failed only if you happened to run it after midnight.
          date: dateColumnFromString(istToday()),
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + 5 * 60 * 60 * 1000),
          feePaise: 50_000,
          status: 'OPEN_FOR_REGISTRATION',
        },
      })
    ).id;

    reception = await signup(app, 'reception@console.test');
    outsider = await signup(app, 'outsider@console.test');
    patientAccountId = (await signup(app, 'patient@console.test')).accountId;
    await prisma.hospitalStaff.create({
      data: { hospitalId, accountId: reception.accountId, role: 'RECEPTION' },
    });

    doctorStaff = await signup(app, 'doctor@console.test');
    await prisma.hospitalStaff.create({
      data: { hospitalId, accountId: doctorStaff.accountId, role: 'DOCTOR' },
    });

    actor = { accountId: null, hospitalId, type: 'SYSTEM' };
  });

  // -------------------------------------------------------------------------
  // The signed QR
  // -------------------------------------------------------------------------

  describe('check-in by scanned code', () => {
    it('checks a patient in from their signed QR', async () => {
      const anita = await book('Anita', 1);

      const res = await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(reception.accessToken))
        .send({ checkInCode: signCheckInCode(anita.reference) })
        .expect(201);

      expect(res.body.entry).toMatchObject({ tokenLabel: 'A001', status: 'CHECKED_IN' });
    });

    it('refuses a tampered code and changes nothing', async () => {
      const anita = await book('Anita', 1);
      const signed = signCheckInCode(anita.reference);

      const res = await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(reception.accessToken))
        .send({ checkInCode: signed.slice(0, -1) + (signed.endsWith('A') ? 'B' : 'A') })
        .expect(404);

      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await statusOf(anita.entryId)).toBe('CONFIRMED');
    });

    it('refuses the bare unsigned reference', async () => {
      // The Phase-5 QR payload. If this still worked the signature would be
      // decoration, and anyone who ever saw a stored reference could check in.
      const anita = await book('Anita', 1);

      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(reception.accessToken))
        .send({ checkInCode: anita.reference })
        .expect(404);

      expect(await statusOf(anita.entryId)).toBe('CONFIRMED');
    });

    it('answers a forged code exactly as it answers a wrong session', async () => {
      // Same status AND same message, or the endpoint becomes an oracle that says
      // "that code was real, just not here".
      const anita = await book('Anita', 1);
      const other = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });
      const elsewhere = await prisma.oPDSession.create({
        data: {
          hospitalId,
          departmentId: other.departmentId,
          originalDoctorId: other.originalDoctorId,
          currentProviderDoctorId: other.currentProviderDoctorId,
          date: other.date,
          // An hour later: unique(originalDoctorId, date, scheduledStart) means the
          // same doctor cannot run two sessions from the same instant.
          scheduledStart: new Date(other.scheduledStart.getTime() + 60 * 60 * 1000),
          scheduledEnd: other.scheduledEnd,
          feePaise: other.feePaise,
          status: 'OPEN_FOR_REGISTRATION',
        },
      });

      const wrongSession = await http()
        .post(`/sessions/${elsewhere.id}/check-in`)
        .set(auth(reception.accessToken))
        .send({ checkInCode: signCheckInCode(anita.reference) })
        .expect(404);

      const forged = await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(reception.accessToken))
        .send({ checkInCode: signCheckInCode('never-issued-reference-000000') })
        .expect(404);

      expect(forged.body.error.message).toBe(wrongSession.body.error.message);
    });

    it('is idempotent - reception double-scans constantly', async () => {
      const anita = await book('Anita', 1);
      const code = signCheckInCode(anita.reference);
      const send = () =>
        http()
          .post(`/sessions/${sessionId}/check-in`)
          .set(auth(reception.accessToken))
          .send({ checkInCode: code })
          .expect(201);

      await send();
      const first = await prisma.queueEntry.findUniqueOrThrow({ where: { id: anita.entryId } });
      await send();
      const second = await prisma.queueEntry.findUniqueOrThrow({ where: { id: anita.entryId } });

      // Not merely "still CHECKED_IN": the ARRIVAL TIME must survive, or a second
      // scan quietly rewrites when the patient actually got here.
      expect(second.checkedInAt).toEqual(first.checkedInAt);
      expect(
        await prisma.queueEvent.count({
          where: { entryId: anita.entryId, type: 'ENTRY_CHECKED_IN' },
        }),
      ).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // The roster
  // -------------------------------------------------------------------------

  describe('GET /sessions/:sessionId/queue', () => {
    it('returns the roster in CALL_ORDER, not token order', async () => {
      await book('Ann', 1);
      const bob = await book('Bob', 2);
      await book('Cara', 3);
      // Escalating Bob must move him ahead of Ann. If the console sorted by token it
      // would show a different "next" than the doctor is actually handed.
      await setPriority(queue, sessionId, actor, {
        entryId: bob.entryId,
        priority: 'EMERGENCY',
        reason: 'chest pain',
      });

      const res = await http()
        .get(`/sessions/${sessionId}/queue`)
        .set(auth(reception.accessToken))
        .expect(200);

      expect(res.body.items.map((e: { tokenLabel: string }) => e.tokenLabel)).toEqual([
        'A002',
        'A001',
        'A003',
      ]);
      expect(res.body).toMatchObject({ total: 3, limit: 100, offset: 0 });
    });

    it('paginates, and never returns an unbounded list', async () => {
      for (let token = 1; token <= 3; token += 1) await book(`P${token}`, token);

      const page = await http()
        .get(`/sessions/${sessionId}/queue?limit=2&offset=2`)
        .set(auth(reception.accessToken))
        .expect(200);
      expect(page.body).toMatchObject({ total: 3, limit: 2, offset: 2 });
      expect(page.body.items).toHaveLength(1);

      await http()
        .get(`/sessions/${sessionId}/queue?limit=500`)
        .set(auth(reception.accessToken))
        .expect(400);
    });

    it('filters by status', async () => {
      await book('Ann', 1);
      const bob = await book('Bob', 2);
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(reception.accessToken))
        .send({ tokenNumber: 2 })
        .expect(201);

      const res = await http()
        .get(`/sessions/${sessionId}/queue?status=CHECKED_IN`)
        .set(auth(reception.accessToken))
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].id).toBe(bob.entryId);
    });

    it('refuses staff from another hospital, and anyone with no membership', async () => {
      await book('Ann', 1);

      const stranger = await http()
        .get(`/sessions/${sessionId}/queue`)
        .set(auth(outsider.accessToken))
        .expect(403);
      expect(stranger.body.error.code).toBe('TENANT_MISMATCH');

      await http().get(`/sessions/${sessionId}/queue`).expect(401);
    });

    it('carries the patient name - this is the staff shape, not a patient one', async () => {
      await book('Anita Sharma', 1);
      const res = await http()
        .get(`/sessions/${sessionId}/queue`)
        .set(auth(reception.accessToken))
        .expect(200);

      expect(res.body.items[0].patientName).toBe('Anita Sharma');
      // ...and NOT the QR code. Staff scan a patient's screen; they are never handed
      // the means to check anybody in without them.
      expect(res.body.items[0]).not.toHaveProperty('checkInCode');
    });
  });

  // -------------------------------------------------------------------------
  // Reading the doctor list (widened in Phase 6)
  // -------------------------------------------------------------------------

  describe('GET /hospitals/:hospitalId/doctors', () => {
    it('lets reception READ the doctor list', async () => {
      // The console names the doctor running each session. This was ADMIN-only and
      // 500'd the whole queue page for a receptionist - found by opening it, not by
      // any test.
      const res = await http()
        .get(`/hospitals/${hospitalId}/doctors?limit=100`)
        .set(auth(reception.accessToken))
        .expect(200);

      expect(res.body.items[0]).toMatchObject({ name: 'Dr Q' });
    });

    it('still refuses to let reception CHANGE a doctor', async () => {
      // The whole point of widening only the GETs. A receptionist can see who works
      // here and can alter nothing about them.
      const doctor = await prisma.doctor.findFirstOrThrow({ where: { hospitalId } });

      await http()
        .patch(`/hospitals/${hospitalId}/doctors/${doctor.id}`)
        .set(auth(reception.accessToken))
        .send({ name: 'Dr Not Allowed' })
        .expect(403);

      await http()
        .post(`/hospitals/${hospitalId}/doctors`)
        .set(auth(reception.accessToken))
        .send({ departmentId: doctor.departmentId, name: 'Dr Sneaky' })
        .expect(403);

      expect((await prisma.doctor.findUniqueOrThrow({ where: { id: doctor.id } })).name).toBe('Dr Q');
    });

    it('still refuses another hospital entirely', async () => {
      await http()
        .get(`/hospitals/${hospitalId}/doctors`)
        .set(auth(outsider.accessToken))
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // Staff cancellation
  // -------------------------------------------------------------------------

  describe('POST /sessions/:sessionId/cancel-entry', () => {
    const cancel = (entryId: string, cause: string, token = reception.accessToken) =>
      http()
        .post(`/sessions/${sessionId}/cancel-entry`)
        .set(auth(token))
        .send({ entryId, cause, reason: 'doctor called away' });

    it('refunds in full when the HOSPITAL cancelled', async () => {
      const anita = await book('Anita', 1, { paidPaise: 50_000 });

      const res = await cancel(anita.entryId, 'HOSPITAL').expect(201);

      expect(res.body.result.entry).toMatchObject({ status: 'CANCELLED' });
      expect(res.body.refund).toMatchObject({ amountPaise: 50_000, refundPct: 100 });
      expect(await statusOf(anita.entryId)).toBe('CANCELLED');
    });

    it('applies the hospital policy tier when the PATIENT asked', async () => {
      // The session started two hours ago, so this is the late tier - the same
      // number the app would have shown the patient before they tapped Cancel.
      const anita = await book('Anita', 1, { paidPaise: 50_000 });

      const res = await cancel(anita.entryId, 'PATIENT_REQUEST').expect(201);

      const policy = await prisma.queuePolicy.findUniqueOrThrow({ where: { hospitalId } });
      const rules = policy.cancellationRules as { lateCancellationRefundPct: number };
      expect(res.body.refund.refundPct).toBe(rules.lateCancellationRefundPct);
      expect(res.body.refund.amountPaise).toBe((50_000 * rules.lateCancellationRefundPct) / 100);
    });

    it('raises exactly one refund for two concurrent cancels', async () => {
      // The Phase-5 bug, re-pinned on the new path. A SEQUENTIAL version of this
      // test passed against the buggy code; only Promise.all catches it.
      const anita = await book('Anita', 1, { paidPaise: 50_000 });

      await Promise.all([cancel(anita.entryId, 'HOSPITAL'), cancel(anita.entryId, 'HOSPITAL')]);

      expect(await prisma.refund.findMany({ where: { hospitalId } })).toHaveLength(1);
      const payment = await prisma.payment.findFirstOrThrow({ where: { hospitalId } });
      expect(payment.refundedPaise).toBe(50_000);
    });

    it('raises no refund for an unpaid hold', async () => {
      const anita = await book('Anita', 1);
      const res = await cancel(anita.entryId, 'HOSPITAL').expect(201);

      expect(res.body.refund).toBeNull();
      expect(await prisma.refund.count()).toBe(0);
    });

    it('demands a written reason, and refuses an invented cause', async () => {
      const anita = await book('Anita', 1, { paidPaise: 50_000 });

      await http()
        .post(`/sessions/${sessionId}/cancel-entry`)
        .set(auth(reception.accessToken))
        .send({ entryId: anita.entryId, cause: 'HOSPITAL' })
        .expect(400);

      await http()
        .post(`/sessions/${sessionId}/cancel-entry`)
        .set(auth(reception.accessToken))
        .send({ entryId: anita.entryId, cause: 'BECAUSE', reason: 'no reason at all' })
        .expect(400);

      expect(await statusOf(anita.entryId)).toBe('CONFIRMED');
    });

    it('writes the reason and the cause to the audit trail', async () => {
      const anita = await book('Anita', 1, { paidPaise: 50_000 });
      await cancel(anita.entryId, 'HOSPITAL').expect(201);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { entityId: anita.entryId, action: 'queue.CANCEL_ENTRY' },
      });
      expect(audit.reason).toBe('doctor called away');
      expect(audit.actorType).toBe('STAFF');

      const refund = await prisma.refund.findFirstOrThrow({ where: { hospitalId } });
      expect(refund.reason).toContain('hospital cancelled');
    });

    it('refuses staff from another hospital', async () => {
      const anita = await book('Anita', 1, { paidPaise: 50_000 });
      const res = await cancel(anita.entryId, 'HOSPITAL', outsider.accessToken).expect(403);

      expect(res.body.error.code).toBe('TENANT_MISMATCH');
      expect(await statusOf(anita.entryId)).toBe('CONFIRMED');
    });
  });
  // -------------------------------------------------------------------------
  // Who may touch the clinical record
  // -------------------------------------------------------------------------

  /**
   * The queue controller carried ONE `@Roles('ADMIN','RECEPTION','DOCTOR')` over all
   * thirteen commands, so the front desk could record that a doctor had seen a
   * patient. Its own comment deferred the split to "a Phase 6/9 concern" and both
   * phases shipped without it; the pre-production audit found it still open.
   *
   * Starting and completing a consultation are the clinical record - they assert a
   * doctor saw this patient - and PRD 6.2 gives them to the doctor. Everything else
   * on the board stays shared, because the desk really does run it.
   *
   * Both directions are asserted. A test that only proved the doctor CAN would still
   * pass if the split were reverted tomorrow.
   */
  describe('only a doctor may start or complete a consultation (PRD 6.2)', () => {
    /** A checked-in patient, called, with the doctor marked present. */
    async function readyToBeSeen(): Promise<string> {
      const anita = await book('Anita', 1);
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(reception.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);
      // call-next and start-consultation both refuse a doctor nobody marked present.
      await http()
        .post(`/sessions/${sessionId}/presence`)
        .set(auth(reception.accessToken))
        .send({ presence: 'PRESENT' })
        .expect(201);
      await http()
        .post(`/sessions/${sessionId}/call-next`)
        .set(auth(reception.accessToken))
        .expect(201);
      return anita.entryId;
    }

    it('refuses reception a start-consultation, and changes nothing', async () => {
      const entryId = await readyToBeSeen();

      await http()
        .post(`/sessions/${sessionId}/start-consultation`)
        .set(auth(reception.accessToken))
        .send({ entryId })
        .expect(403);

      // Still CALLED - the refusal changed nothing. call-next leaves them CALLED;
      // only start-consultation moves them on, which is the thing just refused.
      expect(await statusOf(entryId)).toBe('CALLED');
    });

    it('refuses reception a complete-consultation', async () => {
      const entryId = await readyToBeSeen();
      await http()
        .post(`/sessions/${sessionId}/start-consultation`)
        .set(auth(doctorStaff.accessToken))
        .send({ entryId })
        .expect(201);

      await http()
        .post(`/sessions/${sessionId}/complete-consultation`)
        .set(auth(reception.accessToken))
        .send({ entryId })
        .expect(403);

      expect(await statusOf(entryId)).toBe('IN_CONSULTATION');
    });

    it('lets the doctor do both', async () => {
      const entryId = await readyToBeSeen();

      await http()
        .post(`/sessions/${sessionId}/start-consultation`)
        .set(auth(doctorStaff.accessToken))
        .send({ entryId })
        .expect(201);
      expect(await statusOf(entryId)).toBe('IN_CONSULTATION');

      await http()
        .post(`/sessions/${sessionId}/complete-consultation`)
        .set(auth(doctorStaff.accessToken))
        .send({ entryId })
        .expect(201);
      expect(await statusOf(entryId)).toBe('COMPLETED');
    });

    it('still lets reception run the desk - check-in, walk-in and priority', async () => {
      // The other side of the split. If someone "tightens" the class default to
      // DOCTOR only, reception loses the desk and this fails.
      const anita = await book('Anita', 1);
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(reception.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);

      await http()
        .post(`/sessions/${sessionId}/walk-in`)
        .set(auth(reception.accessToken))
        .send({ name: 'Walk In' })
        .expect(201);

      await http()
        .post(`/sessions/${sessionId}/priority`)
        .set(auth(reception.accessToken))
        .send({ entryId: anita.entryId, priority: 'EMERGENCY', reason: 'chest pain' })
        .expect(201);
    });
  });
});
