import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, request, resetDb, signup } from './helpers';

describe('auth (P1-BE-01, P1-BE-02)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());

  it('signup -> login -> refresh -> logout', async () => {
    const signupRes = await http()
      .post('/auth/signup')
      .send({ email: 'A@Example.com', password: 'correct-horse-battery', name: 'Asha' })
      .expect(201);
    expect(signupRes.body.accessToken).toBeTypeOf('string');

    const loginRes = await http()
      .post('/auth/login')
      .send({ email: 'a@example.com', password: 'correct-horse-battery' })
      .expect(200);

    const refreshRes = await http()
      .post('/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken })
      .expect(200);
    expect(refreshRes.body.refreshToken).not.toBe(loginRes.body.refreshToken);

    await http()
      .post('/auth/logout')
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(204);

    await http()
      .post('/auth/refresh')
      .send({ refreshToken: refreshRes.body.refreshToken })
      .expect(401);
  });

  it('normalises email case and creates the SELF profile when a name is given', async () => {
    const { accessToken } = await signup(app, 'Mixed.Case@Example.com');
    const me = await http().get('/me').set(auth(accessToken)).expect(200);
    expect(me.body.email).toBe('mixed.case@example.com');
    expect(me.body.hasPassword).toBe(true);
    expect(me.body.linkedGoogle).toBe(false);
    expect(me.body.memberships).toEqual([]);
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    await signup(app, 'real@example.com');

    const wrongPassword = await http()
      .post('/auth/login')
      .send({ email: 'real@example.com', password: 'not-the-password' })
      .expect(401);

    const noSuchAccount = await http()
      .post('/auth/login')
      .send({ email: 'ghost@example.com', password: 'not-the-password' })
      .expect(401);

    // requestId differs per request by design; everything a caller could use to
    // distinguish "wrong password" from "no such account" must be identical.
    const observable = (e: { code: string; message: string }) => ({
      code: e.code,
      message: e.message,
    });
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(observable(noSuchAccount.body.error)).toEqual(observable(wrongPassword.body.error));
  });

  it('rejects a duplicate email with a distinct code', async () => {
    await signup(app, 'dupe@example.com');
    const res = await http()
      .post('/auth/signup')
      .send({ email: 'dupe@example.com', password: 'correct-horse-battery' })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects a short password and never echoes it back', async () => {
    const res = await http()
      .post('/auth/signup')
      .send({ email: 'weak@example.com', password: 'short' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(res.body)).not.toContain('short');
  });

  it('revokes the whole family when a rotated refresh token is replayed', async () => {
    const { refreshToken } = await signup(app, 'reuse@example.com');

    const rotated = await http()
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    // Replaying the consumed token means it leaked.
    await http().post('/auth/refresh').send({ refreshToken }).expect(401);

    // ...so the attacker's freshly-issued token must die with it.
    await http()
      .post('/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('two concurrent refreshes with the same token yield exactly one session', async () => {
    const { refreshToken } = await signup(app, 'race@example.com');

    // Fired together: without an atomic claim both would succeed, handing out two
    // live sessions and silently defeating reuse detection.
    const [a, b] = await Promise.all([
      http().post('/auth/refresh').send({ refreshToken }),
      http().post('/auth/refresh').send({ refreshToken }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);

    // The loser tripped reuse detection, so the winner's token is dead too.
    const winner = a.status === 200 ? a : b;
    await http()
      .post('/auth/refresh')
      .send({ refreshToken: winner.body.refreshToken })
      .expect(401);
  });

  it('rejects a date of birth in the future', async () => {
    const { accessToken } = await signup(app, 'dob@example.com');
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

    const res = await http()
      .post('/patients')
      .set(auth(accessToken))
      .send({ name: 'Time traveller', relation: 'CHILD', dob: tomorrow })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');

    // A past date is still accepted.
    await http()
      .post('/patients')
      .set(auth(accessToken))
      .send({ name: 'Real child', relation: 'CHILD', dob: '2015-04-02T00:00:00.000Z' })
      .expect(201);
  });

  it('does not let a password login work on a Google-only account', async () => {
    await prisma.account.create({
      data: { email: 'google-only@example.com', googleId: 'google-sub-1' },
    });
    await http()
      .post('/auth/login')
      .send({ email: 'google-only@example.com', password: 'correct-horse-battery' })
      .expect(401);
  });

  it('rejects /auth/google when no client id is configured', async () => {
    const res = await http().post('/auth/google').send({ idToken: 'anything' }).expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});
