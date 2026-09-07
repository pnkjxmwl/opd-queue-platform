import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, request, resetDb, signup } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { RazorpayClient } from '../src/modules/payments/razorpay.client';
import { FakeRazorpay, capturedWebhookBody, signWebhook } from './razorpay.fake';
import { dateColumnFromString, istToday } from '../src/common/ist';

/**
 * P9-TEST-01 · one patient, all the way through.
 *
 * Every phase already has its own suite, and between them the coverage is good. What
 * none of them do is walk a single patient from discovery to a completed
 * consultation in one continuous story, and that is exactly where the gaps between
 * phases live: the join that works and the check-in that cannot find it, the
 * consultation that completes without an audit row. A phase-shaped test cannot see a
 * seam it sits entirely on one side of.
 *
 * The assertions are deliberately about the TRAIL as much as the state. docs/Rules.md
 * 7 makes QueueEvent and AuditLog part of the product rather than debugging aids -
 * "accountability is a feature" - so a step that changes the queue without leaving
 * both is a failure even when the queue ends up right.
 */
describe('the whole journey (P9-TEST-01)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let razorpay: FakeRazorpay;

  let hospitalId: string;
  let departmentId: string;
  let doctorId: string;
  let sessionId: string;
  let patientToken: string;
  let patientId: string;
  let staffToken: string;
  let doctorToken: string;

  const FEE_PAISE = 50_000;

  beforeAll(async () => {
    razorpay = new FakeRazorpay();
    ({ app, prisma } = await createTestApp([{ provide: RazorpayClient, useValue: razorpay }]));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    razorpay.orders = [];
    razorpay.refunds = [];

    hospitalId = (
      await prisma.hospital.create({
        data: { name: 'Journey General', city: 'Mumbai', status: 'VERIFIED' },
      })
    ).id;
    departmentId = (await prisma.department.create({ data: { hospitalId, name: 'Cardiology' } })).id;
    doctorId = (
      await prisma.doctor.create({
        data: { hospitalId, departmentId, name: 'Dr Journey', defaultConsultMins: 10 },
      })
    ).id;

    const start = new Date(Date.now() - 30 * 60 * 1000);
    sessionId = (
      await prisma.oPDSession.create({
        data: {
          hospitalId,
          departmentId,
          originalDoctorId: doctorId,
          currentProviderDoctorId: doctorId,
          date: dateColumnFromString(istToday()),
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + 4 * 60 * 60 * 1000),
          feePaise: FEE_PAISE,
          status: 'OPEN_FOR_REGISTRATION',
          doctorPresence: 'PRESENT',
        },
      })
    ).id;

    const patient = await signup(app, `journey-patient-${Date.now()}@test.dev`);
    patientToken = patient.accessToken;
    patientId = (
      await prisma.patient.create({
        data: { accountId: patient.accountId, name: 'Asha Semwal', relation: 'SELF' },
      })
    ).id;

    const staff = await signup(app, `journey-staff-${Date.now()}@test.dev`);
    staffToken = staff.accessToken;
    await prisma.hospitalStaff.create({
      data: { hospitalId, accountId: staff.accountId, role: 'RECEPTION', status: 'ACTIVE' },
    });

    // Two logins, because a real clinic has two people. Starting and completing a
    // consultation are the doctor's (PRD 6.2) and the API refuses them from the
    // desk; running the whole journey on one token would have tested a hospital
    // that does not exist.
    const clinician = await signup(app, `journey-doctor-${Date.now()}@test.dev`);
    doctorToken = clinician.accessToken;
    await prisma.hospitalStaff.create({
      data: { hospitalId, accountId: clinician.accountId, role: 'DOCTOR', status: 'ACTIVE' },
    });
  });

  const command = (name: string, body: Record<string, unknown> = {}, token = staffToken) =>
    request(app.getHttpServer())
      .post(`/sessions/${sessionId}/${name}`)
      .set(auth(token))
      .send(body);

  /** Both trails, for one entry, as the engine is required to write them. */
  const trail = async (entryId: string) => {
    const [events, audits] = await Promise.all([
      prisma.queueEvent.findMany({ where: { entryId }, orderBy: { createdAt: 'asc' } }),
      prisma.auditLog.findMany({ where: { hospitalId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { events: events.map((e) => e.type), audits: audits.length };
  };

  it('discover -> join -> pay -> check in -> consult -> complete', async () => {
    // --- discover -------------------------------------------------------------
    const sessions = await request(app.getHttpServer())
      .get(`/departments/${departmentId}/sessions`)
      .set(auth(patientToken))
      .expect(200);
    expect(sessions.body.items.map((s: { id: string }) => s.id)).toContain(sessionId);

    // --- join: a place is held, and NO money has moved yet ---------------------
    const joined = await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/join`)
      .set(auth(patientToken))
      .send({ patientId })
      .expect(201);

    const entryId = joined.body.entry.id as string;
    const orderId = joined.body.razorpayOrderId as string;
    let entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.status).toBe('RESERVED');
    expect(entry.reservationExpiresAt).not.toBeNull();
    expect(await prisma.payment.count({ where: { status: 'SUCCESS' } })).toBe(0);

    // --- pay: the token exists only because the WEBHOOK said so ---------------
    const body = capturedWebhookBody(orderId, 'pay_journey_1', FEE_PAISE);
    await request(app.getHttpServer())
      .post('/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', signWebhook(body))
      .send(body)
      .expect(201);

    entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.status).toBe('CONFIRMED');
    expect(entry.tokenLabel).toMatch(/^A0*1$/);
    // The hold is gone: a confirmed seat is not also counting down to expiry.
    expect(entry.reservationExpiresAt).toBeNull();

    // --- check in: reception, at the desk -------------------------------------
    await command('check-in', { tokenNumber: entry.tokenNumber }).expect(201);
    entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.status).toBe('CHECKED_IN');
    expect(entry.checkedInAt).not.toBeNull();

    // --- called, seen, and finished -------------------------------------------
    await command('call-next').expect(201);
    entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.status).toBe('CALLED');
    expect(entry.calledAt).not.toBeNull();

    // The doctor, not the desk.
    await command('start-consultation', { entryId }, doctorToken).expect(201);
    await command('complete-consultation', { entryId }, doctorToken).expect(201);

    entry = await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.status).toBe('COMPLETED');
    expect(entry.consultStartedAt).not.toBeNull();
    expect(entry.completedAt).not.toBeNull();

    // --- the timeline is ordered, not merely populated -------------------------
    const at = (d: Date | null) => (d === null ? 0 : d.getTime());
    expect(at(entry.joinedAt)).toBeLessThanOrEqual(at(entry.checkedInAt));
    expect(at(entry.checkedInAt)).toBeLessThanOrEqual(at(entry.calledAt));
    expect(at(entry.calledAt)).toBeLessThanOrEqual(at(entry.consultStartedAt));
    expect(at(entry.consultStartedAt)).toBeLessThanOrEqual(at(entry.completedAt));

    // --- and the trail exists, because accountability is a feature -------------
    const { events, audits } = await trail(entryId);
    expect(events).toEqual([
      'ENTRY_RESERVED',
      'ENTRY_CONFIRMED',
      'ENTRY_CHECKED_IN',
      'ENTRY_CALLED',
      'ENTRY_CONSULTATION_STARTED',
      'ENTRY_CONSULTATION_COMPLETED',
    ]);
    expect(audits).toBeGreaterThan(0);

    // A consultation row, which is what the ETA engine learns the doctor's pace from.
    const consultation = await prisma.consultation.findFirst({ where: { queueEntryId: entryId } });
    expect(consultation).not.toBeNull();
    expect(consultation!.durationSec).toBeGreaterThanOrEqual(0);
  });

  it('leaves money and queue in step when the patient never pays', async () => {
    // The other end of the same journey: an unpaid hold must not become a token, and
    // must not leave a Payment row claiming otherwise.
    const joined = await request(app.getHttpServer())
      .post(`/sessions/${sessionId}/join`)
      .set(auth(patientToken))
      .send({ patientId })
      .expect(201);

    const entry = await prisma.queueEntry.findUniqueOrThrow({
      where: { id: joined.body.entry.id as string },
    });
    expect(entry.status).toBe('RESERVED');
    expect(await prisma.payment.count({ where: { status: 'SUCCESS' } })).toBe(0);

    // Not callable: a reservation is not a place in the queue until it is paid for.
    await command('call-next').expect(409);
  });
});
