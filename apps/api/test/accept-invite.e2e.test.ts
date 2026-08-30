import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, request, resetDb, signup } from './helpers';

/**
 * Accepting a staff invitation - the flow that makes P2-BE-05's invite usable.
 *
 * The security cases matter more than the happy path here. An invitation grants a
 * role inside a hospital, so the token is the only thing standing between a guessed
 * email address and staff access.
 */
describe('accept invite', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let hospitalId: string;
  let adminToken: string;
  let doctorId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  beforeEach(async () => {
    await resetDb(prisma);

    const hospital = await prisma.hospital.create({
      data: { name: 'Apollo', city: 'Mumbai', status: 'VERIFIED' },
    });
    hospitalId = hospital.id;

    const admin = await signup(app, 'admin@test.local');
    await prisma.hospitalStaff.create({
      data: { hospitalId, accountId: admin.accountId, role: 'ADMIN', status: 'ACTIVE' },
    });
    adminToken = admin.accessToken;

    const department = await api()
      .post(`/hospitals/${hospitalId}/departments`)
      .set(auth(adminToken))
      .send({ name: 'Cardiology' })
      .expect(201);

    const doctor = await api()
      .post(`/hospitals/${hospitalId}/doctors`)
      .set(auth(adminToken))
      .send({ departmentId: department.body.id, name: 'Dr. Sharma', defaultConsultMins: 10 })
      .expect(201);
    doctorId = doctor.body.id;
  });

  const invite = async (email: string, role: 'RECEPTION' | 'DOCTOR' = 'RECEPTION') => {
    const res = await api()
      .post(`/hospitals/${hospitalId}/staff`)
      .set(auth(adminToken))
      .send({ email, role, ...(role === 'DOCTOR' ? { doctorId } : {}) })
      .expect(201);
    return res.body as { inviteToken: string; inviteExpiresAt: string; accountId: string };
  };

  it('turns an invitation into a working login', async () => {
    const { inviteToken } = await invite('front.desk@test.local');

    const accepted = await api()
      .post('/auth/accept-invite')
      .send({ token: inviteToken, password: 'correct-horse-battery' })
      .expect(200);
    expect(accepted.body.accessToken).toBeTruthy();

    // The membership is live, and /me proves the role actually took effect.
    const me = await api().get('/me').set(auth(accepted.body.accessToken)).expect(200);
    expect(me.body.memberships).toHaveLength(1);
    expect(me.body.memberships[0]).toMatchObject({ role: 'RECEPTION', status: 'ACTIVE' });
    expect(me.body.hasPassword).toBe(true);

    // And the ordinary login path now works, which is the whole point.
    await api()
      .post('/auth/login')
      .send({ email: 'front.desk@test.local', password: 'correct-horse-battery' })
      .expect(200);
  });

  it('cannot be claimed by signing up with the invited email', async () => {
    // The attack the token exists to prevent: guess an invited address, sign up,
    // inherit the role. Signup must still refuse a known email.
    await invite('dr.sharma@test.local', 'DOCTOR');

    await api()
      .post('/auth/signup')
      .send({ email: 'dr.sharma@test.local', password: 'attacker-password' })
      .expect(409);
  });

  it('burns the token: a second accept fails', async () => {
    const { inviteToken } = await invite('front.desk@test.local');

    await api()
      .post('/auth/accept-invite')
      .send({ token: inviteToken, password: 'correct-horse-battery' })
      .expect(200);

    const replay = await api()
      .post('/auth/accept-invite')
      .send({ token: inviteToken, password: 'another-password-x' })
      .expect(401);
    expect(replay.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unknown or expired token identically', async () => {
    const unknown = await api()
      .post('/auth/accept-invite')
      .send({ token: 'not-a-real-token', password: 'correct-horse-battery' })
      .expect(401);

    const { inviteToken } = await invite('late@test.local');
    await prisma.hospitalStaff.updateMany({
      where: { hospitalId },
      data: { inviteExpiresAt: new Date(Date.now() - 1000) },
    });

    const expired = await api()
      .post('/auth/accept-invite')
      .send({ token: inviteToken, password: 'correct-horse-battery' })
      .expect(401);

    // Same message for both: telling them apart says which guesses were close.
    expect(expired.body.error.message).toBe(unknown.body.error.message);
  });

  it('never overwrites an existing password', async () => {
    // An existing user invited to a hospital. If accepting could set a password,
    // inviting an address would be a way to take over that account.
    const existing = await signup(app, 'patient@test.local', 'their-own-password');
    const { inviteToken } = await invite('patient@test.local');

    await api()
      .post('/auth/accept-invite')
      .send({ token: inviteToken, password: 'attacker-chosen-pw' })
      .expect(200);

    // The attacker's password does not work...
    await api()
      .post('/auth/login')
      .send({ email: 'patient@test.local', password: 'attacker-chosen-pw' })
      .expect(401);

    // ...the original still does, and the membership was activated regardless.
    const login = await api()
      .post('/auth/login')
      .send({ email: 'patient@test.local', password: 'their-own-password' })
      .expect(200);

    const me = await api().get('/me').set(auth(login.body.accessToken)).expect(200);
    expect(me.body.memberships[0].status).toBe('ACTIVE');
    expect(existing.accountId).toBe(me.body.id);
  });

  it('re-invites someone whose invitation is still outstanding', async () => {
    const first = await invite('front.desk@test.local');
    const second = await invite('front.desk@test.local');

    expect(second.inviteToken).not.toBe(first.inviteToken);

    // The replaced token is dead; only the newest one works.
    await api()
      .post('/auth/accept-invite')
      .send({ token: first.inviteToken, password: 'correct-horse-battery' })
      .expect(401);

    await api()
      .post('/auth/accept-invite')
      .send({ token: second.inviteToken, password: 'correct-horse-battery' })
      .expect(200);
  });

  it('refuses to re-invite an already active member', async () => {
    const { inviteToken } = await invite('front.desk@test.local');
    await api()
      .post('/auth/accept-invite')
      .send({ token: inviteToken, password: 'correct-horse-battery' })
      .expect(200);

    await api()
      .post(`/hospitals/${hospitalId}/staff`)
      .set(auth(adminToken))
      .send({ email: 'front.desk@test.local', role: 'RECEPTION' })
      .expect(409);
  });

  it('stores only the hash of the token', async () => {
    const { inviteToken } = await invite('front.desk@test.local');

    const row = await prisma.hospitalStaff.findFirst({
      where: { hospitalId, status: 'INVITED' },
      select: { inviteTokenHash: true },
    });
    // A database leak must not yield usable invitations.
    expect(row?.inviteTokenHash).toBeTruthy();
    expect(row?.inviteTokenHash).not.toBe(inviteToken);
    expect(row?.inviteTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('clears the token once accepted', async () => {
    const { inviteToken } = await invite('front.desk@test.local');
    await api()
      .post('/auth/accept-invite')
      .send({ token: inviteToken, password: 'correct-horse-battery' })
      .expect(200);

    const row = await prisma.hospitalStaff.findFirst({ where: { hospitalId, role: 'RECEPTION' } });
    expect(row?.status).toBe('ACTIVE');
    expect(row?.inviteTokenHash).toBeNull();
    expect(row?.inviteExpiresAt).toBeNull();
  });

  it('gives an invited doctor a login linked to their doctor record', async () => {
    const { inviteToken } = await invite('dr.sharma@test.local', 'DOCTOR');

    const accepted = await api()
      .post('/auth/accept-invite')
      .send({ token: inviteToken, password: 'correct-horse-battery' })
      .expect(200);

    const me = await api().get('/me').set(auth(accepted.body.accessToken)).expect(200);
    expect(me.body.memberships[0]).toMatchObject({ role: 'DOCTOR', status: 'ACTIVE' });

    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    expect(doctor?.accountId).toBe(me.body.id);
  });
});
