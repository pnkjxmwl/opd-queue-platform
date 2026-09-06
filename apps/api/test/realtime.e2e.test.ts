import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENT } from '@opd/contracts';
import { auth, createTestApp, request, resetDb, signup } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { EtaTick } from '../src/modules/eta/eta-tick';
import { dateColumnFromString, istToday } from '../src/common/ist';

/**
 * P7-BE-01 / P7-BE-02 · the realtime gateway.
 *
 * These tests need a socket, so the app really LISTENS here rather than being driven
 * in-process like every other suite. The Redis adapter is deliberately absent: it is
 * installed in `main.ts` only, and a test that needed Redis pub/sub to pass would be
 * testing the adapter rather than the product.
 *
 * The claims that matter are the ones a broken gateway would hide: an unauthenticated
 * socket gets nothing, one hospital's session cannot be subscribed to by guessing its
 * id, a rolled-back command emits NOTHING, and a patient's personal event reaches
 * that patient and nobody else.
 */

/** Wait for one event, or fail with a message that says what was being waited for. */
function waitFor<T>(socket: Socket, event: string, ms = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out after ${ms}ms waiting for "${event}"`));
    }, ms);
    const handler = (payload: T): void => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

/** Assert an event does NOT arrive. Needs a real wait - absence has no callback. */
async function expectSilence(socket: Socket, event: string, ms = 700): Promise<void> {
  const received: unknown[] = [];
  const handler = (payload: unknown): void => {
    received.push(payload);
  };
  socket.on(event, handler);
  await new Promise((resolve) => setTimeout(resolve, ms));
  socket.off(event, handler);
  expect(received, `expected no "${event}", received ${JSON.stringify(received)}`).toEqual([]);
}

describe('realtime gateway (P7-BE-01, P7-BE-02)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let url: string;

  let hospitalId: string;
  let sessionId: string;
  let doctorId: string;
  let staff: Awaited<ReturnType<typeof signup>>;
  let patient: Awaited<ReturnType<typeof signup>>;
  let bystander: Awaited<ReturnType<typeof signup>>;
  let entryId: string;

  const sockets: Socket[] = [];
  const http = () => request(app.getHttpServer());

  /** A connected, authenticated socket. Closed automatically after each test. */
  async function connect(token: string): Promise<Socket> {
    const socket = io(url, { auth: { token }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
      setTimeout(() => reject(new Error('socket never connected')), 4000);
    });
    return socket;
  }

  const subscribe = (socket: Socket, id: string): Promise<{ ok: boolean; error?: string }> =>
    socket.emitWithAck('subscribe', { sessionId: id });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await app.listen(0);
    const address = app.getHttpServer().address();
    url = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
  });

  afterAll(() => app.close());

  afterEach(() => {
    for (const socket of sockets.splice(0)) socket.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);

    const hospital = await prisma.hospital.create({
      data: { name: 'Realtime Hospital', city: 'Mumbai', status: 'VERIFIED' },
    });
    hospitalId = hospital.id;
    const department = await prisma.department.create({ data: { hospitalId, name: 'Cardiology' } });
    doctorId = (
      await prisma.doctor.create({
        data: { hospitalId, departmentId: department.id, name: 'Dr Live', defaultConsultMins: 10 },
      })
    ).id;

    const start = new Date(Date.now() - 60 * 60 * 1000);
    sessionId = (
      await prisma.oPDSession.create({
        data: {
          hospitalId,
          departmentId: department.id,
          originalDoctorId: doctorId,
          currentProviderDoctorId: doctorId,
          date: dateColumnFromString(istToday()),
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + 4 * 60 * 60 * 1000),
          feePaise: 50_000,
          status: 'OPEN_FOR_REGISTRATION',
          // call-next is refused while the doctor is NOT_PRESENT, which is the column
          // default. This suite calls patients to make the socket speak.
          doctorPresence: 'PRESENT',
        },
      })
    ).id;

    staff = await signup(app, 'staff@realtime.test');
    patient = await signup(app, 'patient@realtime.test');
    bystander = await signup(app, 'bystander@realtime.test');
    await prisma.hospitalStaff.create({
      data: { hospitalId, accountId: staff.accountId, role: 'RECEPTION' },
    });

    const person = await prisma.patient.create({
      data: { name: 'Live Patient', accountId: patient.accountId },
    });
    entryId = (
      await prisma.queueEntry.create({
        data: {
          hospitalId,
          sessionId,
          patientId: person.id,
          accountId: patient.accountId,
          tokenNumber: 1,
          tokenLabel: 'A001',
          type: 'ONLINE',
          status: 'CONFIRMED',
          checkInCode: 'realtime-reference-000000',
        },
      })
    ).id;
  });

  // -------------------------------------------------------------------------
  // The handshake
  // -------------------------------------------------------------------------

  describe('authentication', () => {
    it('accepts a socket carrying a valid access token', async () => {
      const socket = await connect(staff.accessToken);
      expect(socket.connected).toBe(true);
    });

    it('disconnects a socket with no token rather than leaving it connected and mute', async () => {
      // A client that believes it is subscribed but is not shows stale data
      // confidently, which is worse than one that knows it is offline.
      const socket = io(url, { transports: ['websocket'], forceNew: true });
      sockets.push(socket);
      await new Promise<void>((resolve) => {
        socket.on('disconnect', () => resolve());
        socket.on('connect_error', () => resolve());
        setTimeout(resolve, 3000);
      });
      expect(socket.connected).toBe(false);
    });

    it('refuses a tampered token', async () => {
      const forged = `${staff.accessToken.slice(0, -2)}xy`;
      const socket = io(url, { auth: { token: forged }, transports: ['websocket'], forceNew: true });
      sockets.push(socket);
      await new Promise<void>((resolve) => {
        socket.on('disconnect', () => resolve());
        socket.on('connect_error', () => resolve());
        setTimeout(resolve, 3000);
      });
      expect(socket.connected).toBe(false);
    });

    it('refuses the REFRESH token - the two secrets are separate for a reason', async () => {
      const socket = io(url, {
        auth: { token: staff.refreshToken },
        transports: ['websocket'],
        forceNew: true,
      });
      sockets.push(socket);
      await new Promise<void>((resolve) => {
        socket.on('disconnect', () => resolve());
        socket.on('connect_error', () => resolve());
        setTimeout(resolve, 3000);
      });
      expect(socket.connected).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Room authorisation
  // -------------------------------------------------------------------------

  describe('room joins are authorised server-side', () => {
    it('lets any signed-in account watch a listable session, staff or not', async () => {
      // The room carries what GET /sessions/:id already returns to any patient, so
      // the answer must be the same one discovery gives.
      const socket = await connect(patient.accessToken);
      expect(await subscribe(socket, sessionId)).toEqual({ ok: true });
    });

    it('refuses a session that does not exist', async () => {
      const socket = await connect(patient.accessToken);
      const ack = await subscribe(socket, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
      expect(ack.ok).toBe(false);
    });

    it('refuses a cancelled session and an unverified hospital IDENTICALLY', async () => {
      // Different answers here would turn the socket into an oracle for which
      // session ids exist across the platform.
      await prisma.oPDSession.update({ where: { id: sessionId }, data: { status: 'CANCELLED' } });
      const socket = await connect(patient.accessToken);
      const cancelled = await subscribe(socket, sessionId);

      await prisma.oPDSession.update({
        where: { id: sessionId },
        data: { status: 'OPEN_FOR_REGISTRATION' },
      });
      await prisma.hospital.update({ where: { id: hospitalId }, data: { status: 'PENDING' } });
      const hidden = await subscribe(socket, sessionId);

      const missing = await subscribe(socket, 'ffffffff-ffff-4fff-8fff-ffffffffffff');
      expect(cancelled).toEqual(hidden);
      expect(hidden).toEqual(missing);
    });

    it('refuses a malformed room request without crashing the socket', async () => {
      const socket = await connect(patient.accessToken);
      expect((await socket.emitWithAck('subscribe', { sessionId: 'session:*' })).ok).toBe(false);
      expect((await socket.emitWithAck('subscribe', null)).ok).toBe(false);
      expect(socket.connected).toBe(true);
    });

    it('sends nothing to a socket that never subscribed', async () => {
      const socket = await connect(bystander.accessToken);
      const acting = http().post(`/sessions/${sessionId}/check-in`).set(auth(staff.accessToken));
      await Promise.all([acting.send({ tokenNumber: 1 }).expect(201), expectSilence(socket, REALTIME_EVENT.sessionUpdated)]);
    });
  });

  // -------------------------------------------------------------------------
  // Emitting, and only after the write is real
  // -------------------------------------------------------------------------

  describe('emit after commit', () => {
    it('announces a committed command to everyone watching the session', async () => {
      const socket = await connect(patient.accessToken);
      expect(await subscribe(socket, sessionId)).toEqual({ ok: true });

      const event = waitFor<{ sessionId: string; version: number }>(
        socket,
        REALTIME_EVENT.sessionUpdated,
      );
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(staff.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);

      expect(await event).toEqual({ sessionId, version: expect.any(Number) });
    });

    it('carries the version the row actually holds after the command', async () => {
      const socket = await connect(staff.accessToken);
      await subscribe(socket, sessionId);

      const event = waitFor<{ version: number }>(socket, REALTIME_EVENT.sessionUpdated);
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(staff.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);
      const announced = (await event).version;

      const row = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(announced).toBe(row.version);
    });

    it('emits NOTHING when the command is refused - no ghost updates', async () => {
      // The risk docs/Phases.md names first for this phase: an event emitted inside a
      // transaction that then rolls back tells a patient they were called while the
      // database disagrees. Nobody is checked in, so call-next is refused.
      const socket = await connect(staff.accessToken);
      await subscribe(socket, sessionId);

      const before = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });
      const refused = await http()
        .post(`/sessions/${sessionId}/call-next`)
        .set(auth(staff.accessToken))
        .send({})
        .expect(409);

      // Name the code. A bare 409 would pass just as happily if the refusal came from
      // somewhere else entirely - and it nearly did: when NOT_PRESENT started blocking
      // call-next, this test kept passing for a completely different reason.
      expect(refused.body.error.code).toBe('NO_ELIGIBLE_PATIENT');

      await expectSilence(socket, REALTIME_EVENT.sessionUpdated);
      const after = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(after.version).toBe(before.version);
    });

    it('emits nothing when the caller is from another hospital', async () => {
      const socket = await connect(staff.accessToken);
      await subscribe(socket, sessionId);
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(bystander.accessToken))
        .send({ tokenNumber: 1 })
        .expect(403);
      await expectSilence(socket, REALTIME_EVENT.sessionUpdated);
    });
  });

  // -------------------------------------------------------------------------
  // The private channel
  // -------------------------------------------------------------------------

  describe('a patient hears about their own booking, and nobody else does', () => {
    it('sends entry.updated to the account that owns the entry', async () => {
      const owner = await connect(patient.accessToken);
      const event = waitFor<{ entryId: string; sessionId: string }>(
        owner,
        REALTIME_EVENT.entryUpdated,
      );

      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(staff.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);

      expect(await event).toMatchObject({ entryId, sessionId });
    });

    it('never sends it to another account, even one watching the same session', async () => {
      const nosy = await connect(bystander.accessToken);
      expect(await subscribe(nosy, sessionId)).toEqual({ ok: true });

      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(staff.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);

      // They are entitled to know the queue moved. They are not entitled to know
      // WHOSE booking moved (docs/Rules.md 8, DPDP).
      await expectSilence(nosy, REALTIME_EVENT.entryUpdated);
    });

    it('puts no patient-identifying data in the session broadcast at all', async () => {
      const socket = await connect(bystander.accessToken);
      await subscribe(socket, sessionId);
      const event = waitFor<Record<string, unknown>>(socket, REALTIME_EVENT.sessionUpdated);

      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(staff.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);

      expect(Object.keys(await event).sort()).toEqual(['sessionId', 'version']);
    });
  });

  // -------------------------------------------------------------------------
  // Time passing
  // -------------------------------------------------------------------------

  describe('the eta tick (P7-BE-04)', () => {
    it('re-broadcasts a session where somebody is waiting, without changing anything', async () => {
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(staff.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);

      const before = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });
      const socket = await connect(patient.accessToken);
      await subscribe(socket, sessionId);

      const event = waitFor<{ version: number }>(socket, REALTIME_EVENT.sessionUpdated);
      const ticked = await app.get(EtaTick).tick();
      expect(ticked).toContain(sessionId);
      expect((await event).version).toBe(before.version);

      const after = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });
      expect(after.version).toBe(before.version);
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    });

    it('skips a session with nobody waiting - there is no wait to re-estimate', async () => {
      expect(await app.get(EtaTick).tick()).not.toContain(sessionId);
    });

    it('skips a paused queue, which is not moving at all', async () => {
      // Two patients, so that after one is called there is still somebody ELIGIBLE.
      // Otherwise the tick would skip this session for having an empty queue and the
      // test would pass without proving anything about pausing.
      const second = await prisma.patient.create({
        data: { name: 'Second Patient', accountId: patient.accountId },
      });
      await prisma.queueEntry.create({
        data: {
          hospitalId,
          sessionId,
          patientId: second.id,
          accountId: patient.accountId,
          tokenNumber: 2,
          tokenLabel: 'A002',
          type: 'ONLINE',
          status: 'CONFIRMED',
          checkInCode: 'realtime-reference-000002',
        },
      });

      for (const tokenNumber of [1, 2]) {
        await http()
          .post(`/sessions/${sessionId}/check-in`)
          .set(auth(staff.accessToken))
          .send({ tokenNumber })
          .expect(201);
      }
      // PAUSE is only legal on an ACTIVE session, and the first call-next is what
      // activates one.
      await http().post(`/sessions/${sessionId}/call-next`).set(auth(staff.accessToken)).send({}).expect(201);
      await http()
        .post(`/sessions/${sessionId}/pause`)
        .set(auth(staff.accessToken))
        .send({ reason: 'doctor stepped out' })
        .expect(201);

      // A002 is still CHECKED_IN and therefore eligible, so the ONLY reason to skip
      // this session is that the queue is paused.
      const waiting = await prisma.queueEntry.count({
        where: { sessionId, status: 'CHECKED_IN' },
      });
      expect(waiting).toBeGreaterThan(0);
      expect(await app.get(EtaTick).tick()).not.toContain(sessionId);
    });

    it('skips a session whose doctor has gone home', async () => {
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(staff.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);
      await http()
        .post(`/sessions/${sessionId}/presence`)
        .set(auth(staff.accessToken))
        .send({ presence: 'LEFT' })
        .expect(201);

      expect(await app.get(EtaTick).tick()).not.toContain(sessionId);
    });
  });
});
