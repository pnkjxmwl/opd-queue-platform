import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { istToday, istWeekday } from '../src/common/ist';
import { auth, createTestApp, request, resetDb, signup } from './helpers';

/**
 * Phase 2 configuration endpoints: departments, doctors, schedules, queue policy,
 * sessions and staff invitations.
 *
 * Three things are asserted everywhere, not just once: every list comes back
 * paginated (docs/Rules.md 6), every route is ADMIN-only unless stated, and no
 * hospital can reach another's rows.
 */
describe('Phase 2 hospital configuration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Hospital A: an admin and a receptionist. Hospital B: an admin, used to prove
  // the tenant boundary from the far side.
  let hospitalA: string;
  let hospitalB: string;
  let adminA: string;
  let receptionA: string;
  let adminB: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);

    const a = await prisma.hospital.create({
      data: { name: 'Apollo', city: 'Mumbai', status: 'VERIFIED' },
    });
    const b = await prisma.hospital.create({
      data: { name: 'Fortis', city: 'Bengaluru', status: 'VERIFIED' },
    });
    hospitalA = a.id;
    hospitalB = b.id;

    const make = async (email: string, hospitalId: string, role: 'ADMIN' | 'RECEPTION') => {
      const account = await signup(app, email);
      await prisma.hospitalStaff.create({
        data: { hospitalId, accountId: account.accountId, role, status: 'ACTIVE' },
      });
      return account.accessToken;
    };

    adminA = await make('admin-a@test.local', hospitalA, 'ADMIN');
    receptionA = await make('reception-a@test.local', hospitalA, 'RECEPTION');
    adminB = await make('admin-b@test.local', hospitalB, 'ADMIN');
  });

  const api = () => request(app.getHttpServer());
  const depts = (hospitalId: string) => `/hospitals/${hospitalId}/departments`;
  const doctors = (hospitalId: string) => `/hospitals/${hospitalId}/doctors`;
  const schedules = (hospitalId: string) => `/hospitals/${hospitalId}/schedules`;
  const sessions = (hospitalId: string) => `/hospitals/${hospitalId}/sessions`;

  const createDept = async (token: string, hospitalId: string, name: string) => {
    const res = await api().post(depts(hospitalId)).set(auth(token)).send({ name }).expect(201);
    return res.body.id as string;
  };

  const createDoctor = async (token: string, hospitalId: string, departmentId: string) => {
    const res = await api()
      .post(doctors(hospitalId))
      .set(auth(token))
      .send({ departmentId, name: 'Dr. Sharma', defaultConsultMins: 10 })
      .expect(201);
    return res.body.id as string;
  };

  describe('departments', () => {
    it('creates, lists paginated, updates and deactivates', async () => {
      const id = await createDept(adminA, hospitalA, 'Cardiology');

      const list = await api().get(depts(hospitalA)).set(auth(adminA)).expect(200);
      // docs/Rules.md 6: a bare array here would be the bug this phase must not ship.
      expect(list.body).toMatchObject({ total: 1, limit: 20, offset: 0 });
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ name: 'Cardiology', isActive: true });

      await api()
        .patch(`${depts(hospitalA)}/${id}`)
        .set(auth(adminA))
        .send({ name: 'Cardiac Sciences' })
        .expect(200);

      await api().delete(`${depts(hospitalA)}/${id}`).set(auth(adminA)).expect(204);

      // DELETE deactivates rather than deleting, so the row is hidden but recoverable.
      const afterDelete = await api().get(depts(hospitalA)).set(auth(adminA)).expect(200);
      expect(afterDelete.body.total).toBe(0);

      const withInactive = await api()
        .get(`${depts(hospitalA)}?includeInactive=true`)
        .set(auth(adminA))
        .expect(200);
      expect(withInactive.body.items[0]).toMatchObject({
        name: 'Cardiac Sciences',
        isActive: false,
      });

      await api()
        .patch(`${depts(hospitalA)}/${id}`)
        .set(auth(adminA))
        .send({ isActive: true })
        .expect(200);
      const reactivated = await api().get(depts(hospitalA)).set(auth(adminA)).expect(200);
      expect(reactivated.body.total).toBe(1);
    });

    it('rejects a duplicate name with 409, not 500', async () => {
      await createDept(adminA, hospitalA, 'Cardiology');
      const res = await api()
        .post(depts(hospitalA))
        .set(auth(adminA))
        .send({ name: 'Cardiology' })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('respects the page size cap and the offset', async () => {
      for (const name of ['A', 'B', 'C']) await createDept(adminA, hospitalA, name);

      const page = await api().get(`${depts(hospitalA)}?limit=2`).set(auth(adminA)).expect(200);
      expect(page.body.items).toHaveLength(2);
      expect(page.body.total).toBe(3);

      const next = await api()
        .get(`${depts(hospitalA)}?limit=2&offset=2`)
        .set(auth(adminA))
        .expect(200);
      expect(next.body.items).toHaveLength(1);

      await api().get(`${depts(hospitalA)}?limit=5000`).set(auth(adminA)).expect(400);
    });

    it('blocks a receptionist from admin configuration', async () => {
      await api().get(depts(hospitalA)).set(auth(receptionA)).expect(403);
      await api().post(depts(hospitalA)).set(auth(receptionA)).send({ name: 'X' }).expect(403);
    });

    it('never reveals another hospital rows', async () => {
      const id = await createDept(adminA, hospitalA, 'Cardiology');

      // B's admin has no membership in A, so the tenant guard rejects outright.
      await api().get(`${depts(hospitalA)}/${id}`).set(auth(adminB)).expect(403);

      // And the id is invisible from inside B: a 404, never a confirmation.
      await api().get(`${depts(hospitalB)}/${id}`).set(auth(adminB)).expect(404);
      await api()
        .patch(`${depts(hospitalB)}/${id}`)
        .set(auth(adminB))
        .send({ name: 'stolen' })
        .expect(404);
    });
  });

  describe('doctors', () => {
    it('refuses a department belonging to another hospital', async () => {
      const foreignDept = await createDept(adminB, hospitalB, 'Cardiology');

      // Both rows exist and the foreign key would be satisfied - only the explicit
      // tenant check catches this.
      await api()
        .post(doctors(hospitalA))
        .set(auth(adminA))
        .send({ departmentId: foreignDept, name: 'Dr. X', defaultConsultMins: 10 })
        .expect(404);
    });

    it('reports hasLogin false until an account is linked', async () => {
      const dept = await createDept(adminA, hospitalA, 'Cardiology');
      const id = await createDoctor(adminA, hospitalA, dept);

      const res = await api().get(`${doctors(hospitalA)}/${id}`).set(auth(adminA)).expect(200);
      expect(res.body).toMatchObject({ hasLogin: false, isActive: true, defaultConsultMins: 10 });
    });
  });

  describe('schedules', () => {
    let deptId: string;
    let doctorId: string;

    beforeEach(async () => {
      deptId = await createDept(adminA, hospitalA, 'Cardiology');
      doctorId = await createDoctor(adminA, hospitalA, deptId);
    });

    it('creates a recurring block and lists it', async () => {
      await api()
        .post(schedules(hospitalA))
        .set(auth(adminA))
        .send({
          doctorId,
          weekday: 1,
          startTime: '10:00',
          endTime: '13:00',
          defaultFeePaise: 50_000,
        })
        .expect(201);

      const list = await api()
        .get(`${schedules(hospitalA)}?doctorId=${doctorId}`)
        .set(auth(adminA))
        .expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0]).toMatchObject({ weekday: 1, date: null, startTime: '10:00' });
    });

    it('rejects a block that ends before it starts', async () => {
      const res = await api()
        .post(schedules(hospitalA))
        .set(auth(adminA))
        .send({
          doctorId,
          weekday: 1,
          startTime: '13:00',
          endTime: '10:00',
          defaultFeePaise: 50_000,
        })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('requires exactly one of weekday or date', async () => {
      const base = { doctorId, startTime: '10:00', endTime: '13:00', defaultFeePaise: 50_000 };
      await api().post(schedules(hospitalA)).set(auth(adminA)).send(base).expect(400);
      await api()
        .post(schedules(hospitalA))
        .set(auth(adminA))
        .send({ ...base, weekday: 1, date: '2026-09-01' })
        .expect(400);
    });

    it('refuses a doctor from another hospital', async () => {
      const foreignDept = await createDept(adminB, hospitalB, 'Cardiology');
      const foreignDoctor = await createDoctor(adminB, hospitalB, foreignDept);

      await api()
        .post(schedules(hospitalA))
        .set(auth(adminA))
        .send({
          doctorId: foreignDoctor,
          weekday: 1,
          startTime: '10:00',
          endTime: '13:00',
          defaultFeePaise: 50_000,
        })
        .expect(404);
    });
  });

  describe('queue policy', () => {
    const url = (hospitalId: string) => `/hospitals/${hospitalId}/queue-policy`;

    it('returns a complete policy before anything is configured', async () => {
      const res = await api().get(url(hospitalA)).set(auth(adminA)).expect(200);
      // The engine must never meet a half-filled policy.
      expect(res.body).toMatchObject({
        orderingStrategy: 'TOKEN_ORDER',
        checkInRequired: true,
        gracePeriodSec: 120,
        recallAttempts: 1,
        requeueBehavior: 'END_OF_QUEUE',
        cutoffOnEtaOverrun: true,
        cutoffMinsBeforeEnd: null,
        maxOnlineTokens: null,
        arriveBeforeMins: 30,
      });
      expect(res.body.cancellationRules).toMatchObject({
        freeCancellationMins: 120,
        noShowRefundPct: 0,
      });
    });

    it('replaces on PUT and reads back', async () => {
      await api()
        .put(url(hospitalA))
        .set(auth(adminA))
        .send({ gracePeriodSec: 300, maxOnlineTokens: 40, arriveBeforeMins: 45 })
        .expect(200);

      const res = await api().get(url(hospitalA)).set(auth(adminA)).expect(200);
      expect(res.body).toMatchObject({
        gracePeriodSec: 300,
        maxOnlineTokens: 40,
        arriveBeforeMins: 45,
        // Everything unsent went back to its default - PUT replaces, it does not patch.
        recallAttempts: 1,
      });
    });

    it('treats an empty body as a reset to defaults', async () => {
      await api().put(url(hospitalA)).set(auth(adminA)).send({ gracePeriodSec: 999 }).expect(200);
      const res = await api().put(url(hospitalA)).set(auth(adminA)).send({}).expect(200);
      expect(res.body.gracePeriodSec).toBe(120);
    });

    it('rejects out-of-range thresholds', async () => {
      await api().put(url(hospitalA)).set(auth(adminA)).send({ gracePeriodSec: -1 }).expect(400);
      await api().put(url(hospitalA)).set(auth(adminA)).send({ maxOnlineTokens: 0 }).expect(400);
      await api()
        .put(url(hospitalA))
        .set(auth(adminA))
        .send({ orderingStrategy: 'RANDOM' })
        .expect(400);
    });

    it('keeps each hospital policy separate', async () => {
      await api().put(url(hospitalA)).set(auth(adminA)).send({ gracePeriodSec: 300 }).expect(200);
      const b = await api().get(url(hospitalB)).set(auth(adminB)).expect(200);
      expect(b.body.gracePeriodSec).toBe(120);
    });
  });

  describe('sessions', () => {
    let deptId: string;
    let doctorId: string;

    beforeEach(async () => {
      deptId = await createDept(adminA, hospitalA, 'Cardiology');
      doctorId = await createDoctor(adminA, hospitalA, deptId);
    });

    it('creates a session OPEN_FOR_REGISTRATION with no status in the request', async () => {
      const res = await api()
        .post(sessions(hospitalA))
        .set(auth(adminA))
        .send({
          doctorId,
          date: '2030-09-01',
          startTime: '10:00',
          endTime: '13:00',
          feePaise: 50_000,
        })
        .expect(201);

      expect(res.body).toMatchObject({
        status: 'OPEN_FOR_REGISTRATION',
        doctorPresence: 'NOT_PRESENT',
        tokenPrefix: 'A',
        departmentId: deptId,
        originalDoctorId: doctorId,
        currentProviderDoctorId: doctorId,
        date: '2030-09-01',
        registrationClosedAt: null,
      });
      // 10:00 IST is 04:30 UTC - the stored instant, not the clock face.
      expect(res.body.scheduledStart).toBe('2030-09-01T04:30:00.000Z');
    });

    /**
     * The console said "Open for registration" and the patient app said
     * "Registration closed", for the same session, at the same moment - because a
     * session had been created for 10:00-12:00 IST at 23:26 IST. Both were right:
     * OPEN_FOR_REGISTRATION is the only status creation can produce, and
     * `registrationGate` closes on `scheduledEnd <= now` before it reads a policy.
     * Nothing reconciles them afterwards, so the row misleads staff for ever.
     */
    it('refuses a session that has already ended, rather than creating one nobody can join', async () => {
      const res = await api()
        .post(sessions(hospitalA))
        .set(auth(adminA))
        .send({
          doctorId,
          date: '2020-01-01',
          startTime: '10:00',
          endTime: '13:00',
          feePaise: 50_000,
        })
        .expect(400);

      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(await prisma.oPDSession.count()).toBe(0);
    });

    /** A clinic that opened at 10:00 and creates the session at 10:30 is normal. */
    it('still accepts a session that has started but not ended', async () => {
      const now = new Date();
      const started = new Date(now.getTime() - 30 * 60_000);
      const ends = new Date(now.getTime() + 90 * 60_000);
      const ist = (d: Date): string =>
        new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(11, 16);
      const istDate = new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

      // Skipped around IST midnight, where "30 minutes ago" is a different date and
      // the two clock times would no longer be in order.
      if (ist(started) < ist(ends)) {
        await api()
          .post(sessions(hospitalA))
          .set(auth(adminA))
          .send({
            doctorId,
            date: istDate,
            startTime: ist(started),
            endTime: ist(ends),
            feePaise: 50_000,
          })
          .expect(201);
      }
    });

    it('rejects a duplicate slot with 409 rather than a 500', async () => {
      const body = {
        doctorId,
        date: '2030-09-01',
        startTime: '10:00',
        endTime: '13:00',
        feePaise: 50_000,
      };
      await api().post(sessions(hospitalA)).set(auth(adminA)).send(body).expect(201);
      const res = await api().post(sessions(hospitalA)).set(auth(adminA)).send(body).expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('generates today sessions from schedules, idempotently', async () => {
      const today = istToday();
      await api()
        .post(schedules(hospitalA))
        .set(auth(adminA))
        .send({
          doctorId,
          weekday: istWeekday(today),
          startTime: '10:00',
          endTime: '13:00',
          defaultFeePaise: 50_000,
        })
        .expect(201);

      // No date in the body: "today" is resolved on the server, in IST.
      const first = await api().post(`${sessions(hospitalA)}/generate`).set(auth(adminA)).send({});
      expect(first.status).toBe(200);
      expect(first.body.created).toHaveLength(1);
      expect(first.body.skipped).toBe(0);
      expect(first.body.created[0]).toMatchObject({
        status: 'OPEN_FOR_REGISTRATION',
        date: today,
        feePaise: 50_000,
      });

      // Staff will double-click. The database constraint, not an application check,
      // is what makes the second run a no-op.
      const second = await api()
        .post(`${sessions(hospitalA)}/generate`)
        .set(auth(adminA))
        .send({})
        .expect(200);
      expect(second.body.created).toHaveLength(0);
      expect(second.body.skipped).toBe(1);

      const list = await api()
        .get(`${sessions(hospitalA)}?date=${today}`)
        .set(auth(adminA))
        .expect(200);
      expect(list.body.total).toBe(1);
    });

    it('does not generate sessions for a deactivated doctor', async () => {
      const today = istToday();
      await api()
        .post(schedules(hospitalA))
        .set(auth(adminA))
        .send({
          doctorId,
          weekday: istWeekday(today),
          startTime: '10:00',
          endTime: '13:00',
          defaultFeePaise: 50_000,
        })
        .expect(201);

      await api().delete(`${doctors(hospitalA)}/${doctorId}`).set(auth(adminA)).expect(204);

      const res = await api()
        .post(`${sessions(hospitalA)}/generate`)
        .set(auth(adminA))
        .send({})
        .expect(200);
      expect(res.body.created).toHaveLength(0);
      expect(res.body.skipped).toBe(0);
    });

    it('lets reception read sessions but not create them', async () => {
      await api().get(sessions(hospitalA)).set(auth(receptionA)).expect(200);
      await api()
        .post(sessions(hospitalA))
        .set(auth(receptionA))
        .send({
          doctorId,
          date: '2030-09-01',
          startTime: '10:00',
          endTime: '13:00',
          feePaise: 50_000,
        })
        .expect(403);
    });

    it('paginates the session list', async () => {
      for (const startTime of ['08:00', '10:00', '12:00']) {
        await api()
          .post(sessions(hospitalA))
          .set(auth(adminA))
          .send({
            doctorId,
            date: '2030-09-01',
            startTime,
            endTime: '13:30',
            feePaise: 50_000,
          })
          .expect(201);
      }

      const page = await api().get(`${sessions(hospitalA)}?limit=2`).set(auth(adminA)).expect(200);
      expect(page.body.items).toHaveLength(2);
      expect(page.body.total).toBe(3);
    });
  });

  describe('staff invitations', () => {
    const staffUrl = (hospitalId: string) => `/hospitals/${hospitalId}/staff`;

    it('invites a doctor and links the login to the doctor record', async () => {
      const deptId = await createDept(adminA, hospitalA, 'Cardiology');
      const doctorId = await createDoctor(adminA, hospitalA, deptId);

      const res = await api()
        .post(staffUrl(hospitalA))
        .set(auth(adminA))
        .send({ email: 'dr.sharma@test.local', role: 'DOCTOR', doctorId })
        .expect(201);

      expect(res.body).toMatchObject({
        email: 'dr.sharma@test.local',
        role: 'DOCTOR',
        status: 'INVITED',
        doctorId,
      });
      // Returned once, at invite time - MVP has no email channel to send it through.
      expect(res.body.inviteToken).toBeTruthy();
      expect(new Date(res.body.inviteExpiresAt).getTime()).toBeGreaterThan(Date.now());

      const doctor = await api().get(`${doctors(hospitalA)}/${doctorId}`).set(auth(adminA));
      expect(doctor.body.hasLogin).toBe(true);

      // The invited account exists but carries no credential yet.
      const account = await prisma.account.findUnique({
        where: { email: 'dr.sharma@test.local' },
      });
      expect(account?.passwordHash).toBeNull();
    });

    it('requires a doctorId when the role is DOCTOR', async () => {
      await api()
        .post(staffUrl(hospitalA))
        .set(auth(adminA))
        .send({ email: 'someone@test.local', role: 'DOCTOR' })
        .expect(400);
    });

    it('re-inviting an outstanding invitation issues a fresh token', async () => {
      const first = await api()
        .post(staffUrl(hospitalA))
        .set(auth(adminA))
        .send({ email: 'front.desk@test.local', role: 'RECEPTION' })
        .expect(201);

      // Not a 409: an invitation gets lost or expires, and an admin needs a way to
      // resend one. Accepting is what closes it - see test/accept-invite.e2e.test.ts,
      // which also proves the replaced token stops working.
      const second = await api()
        .post(staffUrl(hospitalA))
        .set(auth(adminA))
        .send({ email: 'front.desk@test.local', role: 'RECEPTION' })
        .expect(201);

      expect(second.body.inviteToken).not.toBe(first.body.inviteToken);
      expect(second.body.id).toBe(first.body.id);
    });

    it('refuses to give a doctor a second login', async () => {
      const deptId = await createDept(adminA, hospitalA, 'Cardiology');
      const doctorId = await createDoctor(adminA, hospitalA, deptId);

      await api()
        .post(staffUrl(hospitalA))
        .set(auth(adminA))
        .send({ email: 'first@test.local', role: 'DOCTOR', doctorId })
        .expect(201);

      await api()
        .post(staffUrl(hospitalA))
        .set(auth(adminA))
        .send({ email: 'second@test.local', role: 'DOCTOR', doctorId })
        .expect(409);
    });

    it('is not available to a receptionist', async () => {
      await api()
        .post(staffUrl(hospitalA))
        .set(auth(receptionA))
        .send({ email: 'x@test.local', role: 'RECEPTION' })
        .expect(403);
    });
  });
});
