import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, request, resetDb, signup } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { dateColumnFromString, istToday } from '../src/common/ist';

/**
 * P7-BE-03 · the ETA over a real database.
 *
 * The arithmetic is pinned in `src/modules/eta/eta.engine.test.ts`, which is pure and
 * fast. What can only be checked here is whether the right rows reach it: that
 * "today" means the IST day and not the UTC one, that a substitute doctor's own pace
 * is the one used, and that a patient from another hospital is refused.
 */
describe('eta (P7-BE-03)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let hospitalId: string;
  let departmentId: string;
  let doctorId: string;
  let sessionId: string;
  let staff: Awaited<ReturnType<typeof signup>>;
  let outsider: Awaited<ReturnType<typeof signup>>;

  const http = () => request(app.getHttpServer());

  /** A finished consultation for this doctor, `minutesAgo` in the past. */
  async function consultation(durationMins: number, minutesAgo: number): Promise<void> {
    const person = await prisma.patient.create({ data: { name: `P${Math.random()}` } });
    const endedAt = new Date(Date.now() - minutesAgo * 60_000);
    const entry = await prisma.queueEntry.create({
      data: {
        hospitalId,
        sessionId,
        patientId: person.id,
        tokenNumber: Math.floor(Math.random() * 100_000) + 100,
        tokenLabel: 'X000',
        type: 'WALK_IN',
        status: 'COMPLETED',
      },
    });
    await prisma.consultation.create({
      data: {
        hospitalId,
        queueEntryId: entry.id,
        patientId: person.id,
        doctorId,
        startedAt: new Date(endedAt.getTime() - durationMins * 60_000),
        endedAt,
        durationSec: durationMins * 60,
      },
    });
  }

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(prisma);

    hospitalId = (
      await prisma.hospital.create({
        data: { name: 'ETA Hospital', city: 'Mumbai', status: 'VERIFIED' },
      })
    ).id;
    departmentId = (await prisma.department.create({ data: { hospitalId, name: 'Cardiology' } })).id;
    doctorId = (
      await prisma.doctor.create({
        data: { hospitalId, departmentId, name: 'Dr Pace', defaultConsultMins: 10 },
      })
    ).id;

    const start = new Date(Date.now() - 60 * 60 * 1000);
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
          feePaise: 50_000,
          status: 'ACTIVE',
        },
      })
    ).id;

    staff = await signup(app, 'staff@eta.test');
    outsider = await signup(app, 'outsider@eta.test');
    await prisma.hospitalStaff.create({
      data: { hospitalId, accountId: staff.accountId, role: 'RECEPTION' },
    });
  });

  const read = () => http().get(`/sessions/${sessionId}/eta`).set(auth(staff.accessToken));

  it('says plainly when it is guessing', async () => {
    const res = await read().expect(200);
    expect(res.body).toMatchObject({
      sessionId,
      basis: 'SEED',
      sampleSize: 0,
      expectedConsultMins: 10,
      runningBehind: false,
    });
  });

  it('learns from this doctor once they have seen anybody', async () => {
    // Yesterday, so it is history rather than today.
    await consultation(30, 26 * 60);
    await consultation(30, 27 * 60);

    const res = await read().expect(200);
    expect(res.body.basis).toBe('DOCTOR_HISTORY');
    expect(res.body.sampleSize).toBe(2);
    // Between the seed and the measurement, never outside them.
    expect(res.body.expectedConsultMins).toBeGreaterThan(10);
    expect(res.body.expectedConsultMins).toBeLessThan(30);
  });

  it("weights today's own pace highest", async () => {
    await consultation(10, 26 * 60);
    await consultation(40, 5);
    await consultation(40, 10);
    await consultation(40, 15);

    const res = await read().expect(200);
    expect(res.body.basis).toBe('TODAY');
    expect(res.body.expectedConsultMins).toBeGreaterThan(20);
  });

  it('flags a session running behind, and only once it is a trend', async () => {
    await consultation(10, 26 * 60);
    await consultation(10, 27 * 60);
    await consultation(40, 5);
    expect((await read().expect(200)).body.runningBehind).toBe(false);

    await consultation(40, 10);
    await consultation(40, 15);
    expect((await read().expect(200)).body.runningBehind).toBe(true);
  });

  it('offers a window while the clinic is running', async () => {
    const res = await read().expect(200);
    expect(typeof res.body.joinNowEtaFrom).toBe('string');
    expect(new Date(res.body.joinNowEtaTo).getTime()).toBeGreaterThan(
      new Date(res.body.joinNowEtaFrom).getTime(),
    );
  });

  it('offers none once the doctor has gone home', async () => {
    await prisma.oPDSession.update({
      where: { id: sessionId },
      data: { doctorPresence: 'LEFT' },
    });
    const res = await read().expect(200);
    expect(res.body.joinNowEtaFrom).toBeNull();
    expect(res.body.joinNowEtaTo).toBeNull();
    // The pace is still reported - it is a fact about the doctor, not about now.
    expect(res.body.expectedConsultMins).toBeGreaterThan(0);
  });

  it('offers none once the session is over', async () => {
    await prisma.oPDSession.update({ where: { id: sessionId }, data: { status: 'COMPLETED' } });
    expect((await read().expect(200)).body.joinNowEtaFrom).toBeNull();
  });

  it('follows the SUBSTITUTE doctor after a substitution, not the one who never came', async () => {
    // docs/PRD.md 8.11: crediting the timings to the absent doctor would poison both
    // averages - and estimating from a doctor who is not in the room is worse still.
    const cover = await prisma.doctor.create({
      data: { hospitalId, departmentId, name: 'Dr Cover', defaultConsultMins: 45 },
    });
    await prisma.oPDSession.update({
      where: { id: sessionId },
      data: { currentProviderDoctorId: cover.id },
    });

    const res = await read().expect(200);
    expect(res.body.expectedConsultMins).toBe(45);
    expect(res.body.basis).toBe('SEED');
  });

  it('refuses staff from another hospital', async () => {
    await http().get(`/sessions/${sessionId}/eta`).set(auth(outsider.accessToken)).expect(403);
  });

  it('refuses an unauthenticated caller', async () => {
    await http().get(`/sessions/${sessionId}/eta`).expect(401);
  });
});
