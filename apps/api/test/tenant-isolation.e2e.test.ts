import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, request, resetDb, signup } from './helpers';
import { dateColumnFromString, istToday } from '../src/common/ist';

/**
 * P1-TEST-01 - the suite that protects the whole product.
 *
 * Two claims, proven rather than assumed:
 *   1. A hospital's staff can only ever touch their OWN hospital's data.
 *   2. An account can only ever touch its OWN patient profiles.
 *
 * Every endpoint introduced in Phases 0-1 is covered, not a sample.
 */
describe('tenant isolation + IDOR (P1-TEST-01)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  /** Two hospitals, each with its own staff member, plus an unaffiliated account. */
  async function twoHospitals() {
    const alpha = await prisma.hospital.create({ data: { name: 'Alpha', city: 'Mumbai' } });
    const beta = await prisma.hospital.create({ data: { name: 'Beta', city: 'Pune' } });

    const alphaAdmin = await signup(app, 'admin-a@example.com');
    const betaStaff = await signup(app, 'staff-b@example.com');
    const outsider = await signup(app, 'outsider@example.com');

    await prisma.hospitalStaff.create({
      data: { hospitalId: alpha.id, accountId: alphaAdmin.accountId, role: 'ADMIN' },
    });
    await prisma.hospitalStaff.create({
      data: { hospitalId: beta.id, accountId: betaStaff.accountId, role: 'RECEPTION' },
    });

    return { alpha, beta, alphaAdmin, betaStaff, outsider };
  }

  const MISSING_ID = '2a1f6f4c-0000-4000-8000-000000000000';

  describe('cross-hospital access', () => {
    it("resolves the caller's own hospital, with their role", async () => {
      const { alpha, alphaAdmin } = await twoHospitals();
      const res = await http()
        .get(`/hospitals/${alpha.id}/probe`)
        .set(auth(alphaAdmin.accessToken))
        .expect(200);

      expect(res.body).toMatchObject({ hospitalId: alpha.id, role: 'ADMIN' });
    });

    it("blocks a staff member from another hospital's data", async () => {
      const { beta, alphaAdmin } = await twoHospitals();
      const res = await http()
        .get(`/hospitals/${beta.id}/probe`)
        .set(auth(alphaAdmin.accessToken))
        .expect(403);

      expect(res.body.error.code).toBe('TENANT_MISMATCH');
    });

    it('blocks an account with no membership at all', async () => {
      const { alpha, outsider } = await twoHospitals();
      await http()
        .get(`/hospitals/${alpha.id}/probe`)
        .set(auth(outsider.accessToken))
        .expect(403);
    });

    it('gives the same answer for a foreign hospital and a non-existent one', async () => {
      const { beta, alphaAdmin } = await twoHospitals();

      const foreign = await http()
        .get(`/hospitals/${beta.id}/probe`)
        .set(auth(alphaAdmin.accessToken))
        .expect(403);
      const missing = await http()
        .get(`/hospitals/${MISSING_ID}/probe`)
        .set(auth(alphaAdmin.accessToken))
        .expect(403);

      // A 404-vs-403 difference would let a caller enumerate which hospitals exist.
      expect(missing.body.error.code).toBe(foreign.body.error.code);
    });

    it('refuses a membership that is not ACTIVE', async () => {
      const { alpha, alphaAdmin } = await twoHospitals();
      await prisma.hospitalStaff.updateMany({
        where: { hospitalId: alpha.id, accountId: alphaAdmin.accountId },
        data: { status: 'DISABLED' },
      });

      const res = await http()
        .get(`/hospitals/${alpha.id}/probe`)
        .set(auth(alphaAdmin.accessToken))
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('enforces role within the hospital, not merely membership', async () => {
      const { alpha, beta, alphaAdmin, betaStaff } = await twoHospitals();

      await http()
        .get(`/hospitals/${alpha.id}/admin-only`)
        .set(auth(alphaAdmin.accessToken))
        .expect(200);

      // betaStaff is RECEPTION in Beta, so the ADMIN-only route is denied.
      await http()
        .get(`/hospitals/${beta.id}/admin-only`)
        .set(auth(betaStaff.accessToken))
        .expect(403);
    });
  });

  describe('cross-account IDOR on /patients', () => {
    async function twoAccountsWithPatients() {
      const alice = await signup(app, 'alice@example.com');
      const bob = await signup(app, 'bob@example.com');

      const created = await http()
        .post('/patients')
        .set(auth(alice.accessToken))
        .send({ name: "Alice's mother", relation: 'MOTHER' })
        .expect(201);

      return { alice, bob, alicePatientId: created.body.id as string };
    }

    it("never lists another account's patients", async () => {
      const { bob } = await twoAccountsWithPatients();
      const res = await http().get('/patients').set(auth(bob.accessToken)).expect(200);
      expect(res.body).toEqual([]);
    });

    it("cannot update another account's patient", async () => {
      const { bob, alicePatientId } = await twoAccountsWithPatients();
      await http()
        .patch(`/patients/${alicePatientId}`)
        .set(auth(bob.accessToken))
        .send({ name: 'hijacked' })
        .expect(404);

      const row = await prisma.patient.findUnique({ where: { id: alicePatientId } });
      expect(row?.name).toBe("Alice's mother");
    });

    it("cannot delete another account's patient", async () => {
      const { bob, alicePatientId } = await twoAccountsWithPatients();
      await http().delete(`/patients/${alicePatientId}`).set(auth(bob.accessToken)).expect(404);

      expect(await prisma.patient.findUnique({ where: { id: alicePatientId } })).not.toBeNull();
    });

    it('owner can still do full CRUD on their own profiles', async () => {
      const { alice, alicePatientId } = await twoAccountsWithPatients();

      const updated = await http()
        .patch(`/patients/${alicePatientId}`)
        .set(auth(alice.accessToken))
        .send({ name: 'Sunita' })
        .expect(200);
      expect(updated.body.name).toBe('Sunita');

      await http().delete(`/patients/${alicePatientId}`).set(auth(alice.accessToken)).expect(204);

      const list = await http().get('/patients').set(auth(alice.accessToken)).expect(200);
      expect(list.body).toEqual([]);
    });
  });

  describe('every Phase 0-1 route rejects an unauthenticated caller', () => {
    /** Each guarded route, as a callable that optionally carries a token. */
    const guarded = [
      { name: 'GET /me', call: () => http().get('/me') },
      { name: 'GET /patients', call: () => http().get('/patients') },
      { name: 'POST /patients', call: () => http().post('/patients').send({ name: 'x' }) },
      { name: 'PATCH /patients/:id', call: () => http().patch(`/patients/${MISSING_ID}`).send({}) },
      { name: 'DELETE /patients/:id', call: () => http().delete(`/patients/${MISSING_ID}`) },
      { name: 'GET /hospitals/:id/probe', call: () => http().get(`/hospitals/${MISSING_ID}/probe`) },
    ];

    it.each(guarded)('$name -> 401 with no token', async ({ call }) => {
      await call().expect(401);
    });

    it.each(guarded)('$name -> 401 with a garbage token', async ({ call }) => {
      await call().set(auth('not-a-jwt')).expect(401);
    });

    it('rejects a tampered access token', async () => {
      const { accessToken } = await signup(app, 'tamper@example.com');
      await http()
        .get('/me')
        .set(auth(`${accessToken.slice(0, -3)}aaa`))
        .expect(401);
    });

    it('health endpoints stay public', async () => {
      await http().get('/health').expect(200);
      await http().get('/health/ready').expect(200);
    });
  });
  // -------------------------------------------------------------------------
  // An id that does not exist must be indistinguishable from one you may not have
  // -------------------------------------------------------------------------

  /**
   * `TenantGuard` resolves the hospital from the SESSION ROW, and for an unknown
   * session id it substitutes a sentinel that no membership can match - so an
   * attacker probing ids gets the same answer whether the session is missing or
   * merely someone else's. That is the design, and the design was right.
   *
   * The sentinel was a literal NUL byte. **Postgres rejects NUL in text**
   * (SQLSTATE 22021), so the membership query threw and every unknown session id
   * answered 500 while a real one belonging to another hospital answered 403 -
   * a difference visible to anyone with a loop and a list of UUIDs, which is
   * precisely what the sentinel exists to deny. Found by the console walkthrough
   * on CI reporting `500 vs 404`, three weeks after the guard was written.
   *
   * This asserts the two answers are IDENTICAL, not merely that each is "an error".
   * Asserting only `>= 400` would have passed all along.
   */
  describe('unknown ids answer exactly like forbidden ones', () => {
    async function betaSession(betaId: string): Promise<string> {
      const department = await prisma.department.create({
        data: { hospitalId: betaId, name: 'Beta Dept' },
      });
      const doctor = await prisma.doctor.create({
        data: { hospitalId: betaId, departmentId: department.id, name: 'Dr Beta' },
      });
      const start = new Date(Date.now() - 60 * 60 * 1000);
      const session = await prisma.oPDSession.create({
        data: {
          hospitalId: betaId,
          departmentId: department.id,
          originalDoctorId: doctor.id,
          currentProviderDoctorId: doctor.id,
          date: dateColumnFromString(istToday()),
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + 4 * 60 * 60 * 1000),
          feePaise: 50_000,
          status: 'OPEN_FOR_REGISTRATION',
        },
      });
      return session.id;
    }

    it('answers a missing session exactly as it answers one owned by another hospital', async () => {
      const { beta, alphaAdmin } = await twoHospitals();
      const theirs = await betaSession(beta.id);

      const forbidden = await http()
        .get(`/sessions/${theirs}/queue?limit=5`)
        .set(auth(alphaAdmin.accessToken));
      const missing = await http()
        .get(`/sessions/${MISSING_ID}/queue?limit=5`)
        .set(auth(alphaAdmin.accessToken));

      expect(missing.status).toBe(forbidden.status);
      expect(missing.body.error.code).toBe(forbidden.body.error.code);
      // Named explicitly so a future change to BOTH cannot silently make them 500.
      expect(missing.status).toBe(403);
      expect(missing.body.error.code).toBe('TENANT_MISMATCH');
    });

    it('does not 500 on an unknown session id', async () => {
      // The regression itself, stated on its own so the failure names the cause.
      const { alphaAdmin } = await twoHospitals();

      const res = await http()
        .get(`/sessions/${MISSING_ID}/eta`)
        .set(auth(alphaAdmin.accessToken));

      expect(res.status).not.toBe(500);
      expect(res.status).toBe(403);
    });
  });
});
