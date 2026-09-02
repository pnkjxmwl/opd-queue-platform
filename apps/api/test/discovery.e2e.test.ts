import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { dateColumnFromString, istDateOf, istToday } from '../src/common/ist';
import { auth, createTestApp, request, resetDb, signup } from './helpers';

/**
 * Phase 3 discovery: the patient read path.
 *
 * Two things are asserted throughout. First, **leakage**: this path is deliberately
 * cross-tenant, so an unverified hospital, a deactivated department or doctor, and a
 * cancelled session must never appear - docs/Phases.md calls that the easy thing to
 * miss here. Second, **the frozen response shape**: the queue snapshot and ETA
 * window exist and are null now so that Phase 7 fills them without a breaking change.
 */
describe('Phase 3 discovery', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  /** A signed-in patient with no staff membership anywhere - the real audience. */
  let patient: string;
  let adminA: string;

  let hospitalA: string;
  let hospitalB: string;
  let hospitalPending: string;
  let cardiology: string;
  let closedUnit: string;
  let paediatrics: string;
  let drSharma: string;
  let drGone: string;
  let drNair: string;
  let drCover: string;

  let openSession: string;
  let closedSession: string;
  let cancelledSession: string;
  let yesterdaySession: string;
  let pendingSession: string;
  let substitutedSession: string;

  const today = () => istToday();
  const yesterday = () => istDateOf(new Date(Date.now() - 24 * 60 * 60 * 1000));

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);

    const hospital = async (name: string, city: string, area: string, status: 'VERIFIED' | 'PENDING') =>
      (
        await prisma.hospital.create({
          data: { name, city, area, address: `1 ${area} Road`, status },
        })
      ).id;

    hospitalA = await hospital('Apollo Clinic', 'Mumbai', 'Andheri West', 'VERIFIED');
    hospitalB = await hospital('Fortis Health Point', 'Bengaluru', 'Indiranagar', 'VERIFIED');
    hospitalPending = await hospital('Pending Care', 'Mumbai', 'Bandra', 'PENDING');

    const department = async (hospitalId: string, name: string, isActive = true) =>
      (await prisma.department.create({ data: { hospitalId, name, isActive } })).id;

    cardiology = await department(hospitalA, 'Cardiology');
    closedUnit = await department(hospitalA, 'Closed Unit', false);
    paediatrics = await department(hospitalB, 'Paediatrics');
    const pendingDept = await department(hospitalPending, 'General Medicine');

    const doctor = async (
      hospitalId: string,
      departmentId: string,
      name: string,
      specialization: string | null,
      isActive = true,
    ) =>
      (
        await prisma.doctor.create({
          data: { hospitalId, departmentId, name, specialization, defaultConsultMins: 12, isActive },
        })
      ).id;

    drSharma = await doctor(hospitalA, cardiology, 'Dr. Anita Sharma', 'Interventional Cardiology');
    drGone = await doctor(hospitalA, cardiology, 'Dr. Departed', 'Cardiology', false);
    const drClosed = await doctor(hospitalA, closedUnit, 'Dr. Shuttered', null);
    drNair = await doctor(hospitalB, paediatrics, 'Dr. Arjun Nair', 'Neonatology');
    drCover = await doctor(hospitalB, paediatrics, 'Dr. Priya Cover', 'Paediatrics');
    const drPending = await doctor(hospitalPending, pendingDept, 'Dr. Unlisted', null);

    // Every window is anchored to NOW rather than to a wall-clock time, so
    // `registrationOpen` (scheduledEnd > now) is deterministic whatever hour the
    // suite runs at. Only `date` is a calendar value, and it is IST today.
    const hour = 60 * 60 * 1000;
    const session = async (input: {
      hospitalId: string;
      departmentId: string;
      doctorId: string;
      providerId?: string;
      date?: string;
      startsInHours: number;
      status?: 'OPEN_FOR_REGISTRATION' | 'CANCELLED' | 'COMPLETED';
      closed?: boolean;
    }) => {
      const date = input.date ?? today();
      const start = new Date(Date.now() + input.startsInHours * hour);
      return (
        await prisma.oPDSession.create({
          data: {
            hospitalId: input.hospitalId,
            departmentId: input.departmentId,
            originalDoctorId: input.doctorId,
            currentProviderDoctorId: input.providerId ?? input.doctorId,
            date: dateColumnFromString(date),
            scheduledStart: start,
            scheduledEnd: new Date(start.getTime() + 3 * hour),
            feePaise: 50_000,
            status: input.status ?? 'OPEN_FOR_REGISTRATION',
            ...(input.closed ? { registrationClosedAt: new Date() } : {}),
          },
        })
      ).id;
    };

    // Visible: running now, and a later block for the same doctor (docs/PRD.md 5.1
    // - two sessions in a day are two cards).
    openSession = await session({ hospitalId: hospitalA, departmentId: cardiology, doctorId: drSharma, startsInHours: -1 });
    closedSession = await session({ hospitalId: hospitalA, departmentId: cardiology, doctorId: drSharma, startsInHours: 4, closed: true });

    // Each of these must stay out of every list.
    cancelledSession = await session({ hospitalId: hospitalA, departmentId: cardiology, doctorId: drSharma, startsInHours: 8, status: 'CANCELLED' });
    await session({ hospitalId: hospitalA, departmentId: cardiology, doctorId: drGone, startsInHours: -1 });
    await session({ hospitalId: hospitalA, departmentId: closedUnit, doctorId: drClosed, startsInHours: -1 });
    pendingSession = await session({ hospitalId: hospitalPending, departmentId: pendingDept, doctorId: drPending, startsInHours: -1 });

    yesterdaySession = await session({ hospitalId: hospitalA, departmentId: cardiology, doctorId: drSharma, date: yesterday(), startsInHours: -26 });

    // Booked with Nair, actually run by Cover (docs/PRD.md 8.11).
    substitutedSession = await session({ hospitalId: hospitalB, departmentId: paediatrics, doctorId: drNair, providerId: drCover, startsInHours: -1 });

    patient = (await signup(app, 'patient@test.local')).accessToken;

    const admin = await signup(app, 'admin-a@test.local');
    await prisma.hospitalStaff.create({
      data: { hospitalId: hospitalA, accountId: admin.accountId, role: 'ADMIN', status: 'ACTIVE' },
    });
    adminA = admin.accessToken;
  });

  const api = () => request(app.getHttpServer());
  const get = (path: string, token = patient) => api().get(path).set(auth(token));

  describe('authentication', () => {
    it('requires a signed-in caller', async () => {
      await api().get('/cities').expect(401);
    });

    it('does not require a staff membership - a patient is not staff anywhere', async () => {
      await get('/cities').expect(200);
    });
  });

  describe('cities', () => {
    it('lists only cities that have a listable hospital', async () => {
      const res = await get('/cities').expect(200);
      expect(res.body.total).toBe(2);
      const mumbai = res.body.items.find((c: { name: string }) => c.name === 'Mumbai');
      // Pending Care is also in Mumbai. If it were counted this would be 2, which is
      // the whole point of the assertion.
      expect(mumbai.hospitalCount).toBe(1);
    });

    it('paginates', async () => {
      const res = await get('/cities?limit=1').expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body).toMatchObject({ total: 2, limit: 1, offset: 0 });
    });
  });

  describe('hospitals', () => {
    it('lists verified hospitals with today’s session count from one aggregate', async () => {
      const res = await get('/hospitals').expect(200);
      expect(res.body.total).toBe(2);

      const apollo = res.body.items.find((h: { id: string }) => h.id === hospitalA);
      // Two visible today: the open one and the manually closed one. The cancelled,
      // inactive-doctor, inactive-department and yesterday sessions are excluded.
      expect(apollo.todaySessionCount).toBe(2);
      expect(res.body.items.some((h: { id: string }) => h.id === hospitalPending)).toBe(false);
    });

    it('filters by city, area and name, case-insensitively', async () => {
      expect((await get('/hospitals?city=mumbai').expect(200)).body.total).toBe(1);
      expect((await get('/hospitals?area=indira').expect(200)).body.total).toBe(1);
      expect((await get('/hospitals?q=FORT').expect(200)).body.total).toBe(1);
    });

    it('rejects an oversized page', async () => {
      await get('/hospitals?limit=1000').expect(400);
    });

    it('returns detail for a verified hospital and 404 for an unverified one', async () => {
      const res = await get(`/hospitals/${hospitalA}`).expect(200);
      expect(res.body).toMatchObject({
        name: 'Apollo Clinic',
        address: '1 Andheri West Road',
        todaySessionCount: 2,
      });

      // Not 403: distinguishing "unverified" from "no such id" would confirm which
      // hospital ids exist.
      await get(`/hospitals/${hospitalPending}`).expect(404);
    });
  });

  describe('departments', () => {
    it('lists only active departments of one hospital', async () => {
      const res = await get(`/departments?hospitalId=${hospitalA}`).expect(200);
      expect(res.body.total).toBe(1);
      expect(res.body.items[0]).toMatchObject({ name: 'Cardiology', todaySessionCount: 2 });
      expect(res.body.items.some((d: { id: string }) => d.id === closedUnit)).toBe(false);
    });

    it('requires a hospitalId - the path carries none', async () => {
      await get('/departments').expect(400);
    });

    /**
     * The reason this endpoint is not GET /hospitals/:id/departments. Express
     * matches on route SHAPE, so the Phase-2 admin route would shadow it (or be
     * shadowed by it) and the parameter name would decide whether TenantGuard runs.
     */
    it('leaves the Phase-2 admin route untouched at its own path', async () => {
      // A patient has no membership in hospital A, so TenantGuard refuses - which
      // only happens if that route still resolves to the ADMIN controller.
      await get(`/hospitals/${hospitalA}/departments`).expect(403);

      const asAdmin = await get(`/hospitals/${hospitalA}/departments`, adminA).expect(200);
      // The admin shape, not the discovery shape.
      expect(asAdmin.body.items[0]).toHaveProperty('isActive');
      expect(asAdmin.body.items[0]).not.toHaveProperty('todaySessionCount');
    });
  });

  describe('session cards', () => {
    it('returns today’s cards in start order, hiding everything unlistable', async () => {
      const res = await get(`/departments/${cardiology}/sessions`).expect(200);

      expect(res.body.total).toBe(2);
      expect(res.body.items.map((s: { id: string }) => s.id)).toEqual([openSession, closedSession]);
      for (const hidden of [cancelledSession, yesterdaySession]) {
        expect(res.body.items.some((s: { id: string }) => s.id === hidden)).toBe(false);
      }
    });

    it('carries the doctor, fee and the frozen snapshot shape', async () => {
      const res = await get(`/departments/${cardiology}/sessions`).expect(200);
      const card = res.body.items[0];

      expect(card).toMatchObject({
        hospitalName: 'Apollo Clinic',
        departmentName: 'Cardiology',
        doctorName: 'Dr. Anita Sharma',
        doctorSpecialization: 'Interventional Cardiology',
        isSubstitute: false,
        date: today(),
        feePaise: 50_000,
        status: 'OPEN_FOR_REGISTRATION',
        doctorPresence: 'NOT_PRESENT',
      });

      expect(card.snapshot).toMatchObject({
        nowServingToken: null,
        checkedInCount: 0,
        bookedNotArrivedCount: 0,
        registrationOpen: true,
      });

      // Phase 7 fills what Phase 3 froze as null. An open session with an empty
      // queue still answers "when would I be seen" - with a window starting about
      // now, because there is nobody in front of you.
      expect(typeof card.snapshot.joinNowEtaFrom).toBe('string');
      expect(new Date(card.snapshot.joinNowEtaTo).getTime()).toBeGreaterThan(
        new Date(card.snapshot.joinNowEtaFrom).getTime(),
      );
      // A window, never a point (docs/Phases.md).
      expect(card.snapshot.joinNowEtaFrom).not.toEqual(card.snapshot.joinNowEtaTo);
    });

    it('offers no ETA on a session nobody can join - a time would be an invitation', async () => {
      const res = await get(`/departments/${cardiology}/sessions`).expect(200);
      const closed = res.body.items.find((s: { id: string }) => s.id === closedSession);
      expect(closed.snapshot.registrationOpen).toBe(false);
      expect(closed.snapshot.joinNowEtaFrom).toBeNull();
      expect(closed.snapshot.joinNowEtaTo).toBeNull();
    });

    it('reports a manually closed session as closed for registration', async () => {
      const res = await get(`/departments/${cardiology}/sessions`).expect(200);
      const closed = res.body.items.find((s: { id: string }) => s.id === closedSession);
      expect(closed.status).toBe('OPEN_FOR_REGISTRATION');
      expect(closed.snapshot.registrationOpen).toBe(false);
    });

    it('honours an explicit date and paginates', async () => {
      const past = await get(`/departments/${cardiology}/sessions?date=${yesterday()}`).expect(200);
      expect(past.body.items.map((s: { id: string }) => s.id)).toEqual([yesterdaySession]);

      const page = await get(`/departments/${cardiology}/sessions?limit=1&offset=1`).expect(200);
      expect(page.body).toMatchObject({ total: 2, limit: 1, offset: 1 });
      expect(page.body.items.map((s: { id: string }) => s.id)).toEqual([closedSession]);
    });

    it('headlines the covering doctor after a substitution', async () => {
      const res = await get(`/departments/${paediatrics}/sessions`).expect(200);
      expect(res.body.items[0]).toMatchObject({
        id: substitutedSession,
        doctorName: 'Dr. Priya Cover',
        isSubstitute: true,
      });
    });
  });

  describe('session detail', () => {
    it('adds the address and consult length to the card', async () => {
      const res = await get(`/sessions/${openSession}`).expect(200);
      expect(res.body).toMatchObject({
        id: openSession,
        hospitalArea: 'Andheri West',
        hospitalAddress: '1 Andheri West Road',
        doctorDefaultConsultMins: 12,
      });

      // Phase 7. The doctor has no history, so this window is built from
      // `defaultConsultMins` alone - which is exactly what that column is for, and
      // why a brand-new doctor still gets an honest answer rather than none.
      expect(typeof res.body.snapshot.joinNowEtaFrom).toBe('string');
      expect(new Date(res.body.snapshot.joinNowEtaTo).getTime()).toBeGreaterThan(
        Date.now(),
      );
    });

    it('hides a cancelled session and one belonging to an unverified hospital', async () => {
      await get(`/sessions/${cancelledSession}`).expect(404);
      await get(`/sessions/${pendingSession}`).expect(404);
    });
  });

  describe('doctors', () => {
    it('searches name and specialization, and never returns a hidden doctor', async () => {
      expect((await get('/doctors?q=sharma').expect(200)).body.total).toBe(1);
      expect((await get('/doctors?q=neonat').expect(200)).body.total).toBe(1);
      expect((await get('/doctors?city=Bengaluru').expect(200)).body.total).toBe(2);

      const all = await get('/doctors').expect(200);
      const ids = all.body.items.map((d: { id: string }) => d.id);
      expect(ids).toContain(drSharma);
      // Deactivated doctor, doctor in a deactivated department, doctor at an
      // unverified hospital - none of them are browsable.
      expect(ids).not.toContain(drGone);
      expect(all.body.total).toBe(3);
    });

    it('returns a profile with its department and hospital resolved', async () => {
      const res = await get(`/doctors/${drSharma}`).expect(200);
      expect(res.body).toMatchObject({
        name: 'Dr. Anita Sharma',
        departmentName: 'Cardiology',
        hospitalName: 'Apollo Clinic',
        hospitalCity: 'Mumbai',
        defaultConsultMins: 12,
      });

      await get(`/doctors/${drGone}`).expect(404);
    });

    it('lists the sessions a doctor is actually running, not merely booked for', async () => {
      const sharma = await get(`/doctors/${drSharma}/sessions`).expect(200);
      expect(sharma.body.total).toBe(2);

      // Cover is running it; Nair is only the doctor it was booked with.
      expect((await get(`/doctors/${drCover}/sessions`).expect(200)).body.total).toBe(1);
      expect((await get(`/doctors/${drNair}/sessions`).expect(200)).body.total).toBe(0);
    });
  });
});
