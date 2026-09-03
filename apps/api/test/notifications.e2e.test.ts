import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auth, createTestApp, request, resetDb, signup } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { EventNotifier } from '../src/modules/notifications/event-notifier';
import { LeaveNowNotifier } from '../src/modules/notifications/leave-now';
import { ExpoClient, type PushMessage, type PushResult } from '../src/modules/notifications/expo.client';
import { QueueService } from '../src/modules/queue/queue.service';
import { dateColumnFromString, istToday } from '../src/common/ist';

/**
 * P8-BE-01, P8-BE-02 · what a patient is told, and what stops them being told it
 * eleven times.
 *
 * Expo is faked. Push is fire-and-forget - docs/Phases.md: *"a bad send cannot be
 * recalled"* - so the fake is the only way to assert on what would have gone out.
 */

/** Records every send, and can be told to fail in the two ways that matter. */
class FakeExpo {
  readonly configured = true;
  readonly sent: PushMessage[] = [];
  behaviour: 'ok' | 'device-gone' | 'transient' = 'ok';

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    this.sent.push(...messages);
    return messages.map((message) => ({
      token: message.token,
      ok: this.behaviour === 'ok',
      deviceGone: this.behaviour === 'device-gone',
      error: this.behaviour === 'ok' ? undefined : this.behaviour,
    }));
  }
}

describe('notifications (P8-BE-01, P8-BE-02)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notifications: NotificationsService;
  let expo: FakeExpo;

  let hospitalId: string;
  let sessionId: string;
  let staff: Awaited<ReturnType<typeof signup>>;
  let patient: Awaited<ReturnType<typeof signup>>;
  let entryId: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    expo = new FakeExpo();
    ({ app, prisma } = await createTestApp([{ provide: ExpoClient, useValue: expo }]));
    notifications = app.get(NotificationsService);
  });

  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(prisma);
    expo.sent.length = 0;
    expo.behaviour = 'ok';

    hospitalId = (
      await prisma.hospital.create({
        data: { name: 'Notify Hospital', city: 'Mumbai', status: 'VERIFIED' },
      })
    ).id;
    const departmentId = (await prisma.department.create({ data: { hospitalId, name: 'Cardiology' } }))
      .id;
    const doctorId = (
      await prisma.doctor.create({
        data: { hospitalId, departmentId, name: 'Dr Push', defaultConsultMins: 10 },
      })
    ).id;

    const start = new Date(Date.now() - 30 * 60_000);
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
          status: 'OPEN_FOR_REGISTRATION',
        },
      })
    ).id;

    staff = await signup(app, 'staff@notify.test');
    patient = await signup(app, 'patient@notify.test');
    await prisma.hospitalStaff.create({
      data: { hospitalId, accountId: staff.accountId, role: 'RECEPTION' },
    });

    const person = await prisma.patient.create({
      data: { name: 'Notified Patient', accountId: patient.accountId },
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
          checkInCode: 'notify-reference-00000001',
        },
      })
    ).id;
  });

  const registerDevice = (token = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]') =>
    http().post('/me/push-tokens').set(auth(patient.accessToken)).send({ token, platform: 'android' });

  // -------------------------------------------------------------------------

  describe('registering a device', () => {
    it('registers a push token against the caller, never a body-supplied account', async () => {
      await registerDevice().expect(201);
      const row = await prisma.pushToken.findFirstOrThrow({});
      expect(row.accountId).toBe(patient.accountId);
    });

    it('is idempotent - an app re-registers on every launch', async () => {
      await registerDevice().expect(201);
      await registerDevice().expect(201);
      expect(await prisma.pushToken.count()).toBe(1);
    });

    it('MOVES a token to the account that just registered it', async () => {
      // A phone handed to a family member who signs in as themselves. Leaving two
      // rows would route the first person's pushes to the second.
      const token = 'ExponentPushToken[shared-device-000000]';
      await http().post('/me/push-tokens').set(auth(patient.accessToken)).send({ token }).expect(201);
      await http().post('/me/push-tokens').set(auth(staff.accessToken)).send({ token }).expect(201);

      const rows = await prisma.pushToken.findMany({ where: { token } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.accountId).toBe(staff.accountId);
    });

    it('revives a token that had been pruned', async () => {
      await registerDevice().expect(201);
      await prisma.pushToken.updateMany({ data: { disabledAt: new Date() } });
      await registerDevice().expect(201);
      expect(await prisma.pushToken.findFirstOrThrow({})).toMatchObject({ disabledAt: null });
    });

    it('refuses an unauthenticated caller and a nonsense token', async () => {
      await http().post('/me/push-tokens').send({ token: 'x'.repeat(20) }).expect(401);
      await http().post('/me/push-tokens').set(auth(patient.accessToken)).send({ token: 'no' }).expect(400);
    });
  });

  // -------------------------------------------------------------------------

  describe('recording', () => {
    const record = (type: 'TOKEN_ISSUED' | 'LEAVE_NOW' = 'TOKEN_ISSUED') =>
      notifications.record({
        accountId: patient.accountId,
        entryId,
        sessionId,
        type,
        tokenLabel: 'A001',
        hospitalName: 'Notify Hospital',
      });

    it('writes one row, PENDING, with a deep link and no PII', async () => {
      expect(await record()).toBe(true);
      const row = await prisma.notification.findFirstOrThrow({});
      expect(row.status).toBe('PENDING');
      expect(row.data).toEqual({ type: 'TOKEN_ISSUED', entryId, sessionId });
      // A push renders on a lock screen, in public (docs/Rules.md 8).
      expect(`${row.title} ${row.body} ${JSON.stringify(row.data)}`).not.toContain('Notified Patient');
    });

    it('tells a patient a given thing exactly ONCE, whatever the caller does', async () => {
      // The storm guard, and it is the database's unique(entryId, type) rather than
      // a check in the service - the sweeps that call this overlap.
      const results = await Promise.all([record(), record(), record(), record()]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await prisma.notification.count()).toBe(1);
    });

    it('still allows a DIFFERENT message about the same booking', async () => {
      expect(await record('TOKEN_ISSUED')).toBe(true);
      expect(await record('LEAVE_NOW')).toBe(true);
      expect(await prisma.notification.count()).toBe(2);
    });
  });

  // -------------------------------------------------------------------------

  describe('dispatching', () => {
    beforeEach(async () => {
      await registerDevice().expect(201);
      await notifications.record({
        accountId: patient.accountId,
        entryId,
        sessionId,
        type: 'TOKEN_ISSUED',
        tokenLabel: 'A001',
        hospitalName: 'Notify Hospital',
      });
    });

    it('sends what is pending and marks it sent', async () => {
      expect(await notifications.dispatch()).toEqual({ sent: 1, failed: 0 });
      expect(expo.sent[0]?.title).toContain('A001');
      expect(await prisma.notification.findFirstOrThrow({})).toMatchObject({ status: 'SENT' });
    });

    it('never sends the same notification twice', async () => {
      await notifications.dispatch();
      expect(await notifications.dispatch()).toEqual({ sent: 0, failed: 0 });
      expect(expo.sent).toHaveLength(1);
    });

    it('prunes a device Expo says is gone, so the delivery rate does not rot', async () => {
      expo.behaviour = 'device-gone';
      await notifications.dispatch();

      const token = await prisma.pushToken.findFirstOrThrow({});
      expect(token.disabledAt).not.toBeNull();
      // Every device gone means there is nowhere left to try.
      expect(await prisma.notification.findFirstOrThrow({})).toMatchObject({ status: 'FAILED' });
    });

    it('retries a transient failure rather than giving up', async () => {
      expo.behaviour = 'transient';
      await notifications.dispatch();
      expect(await prisma.notification.findFirstOrThrow({})).toMatchObject({
        status: 'PENDING',
        attempts: 1,
      });

      expo.behaviour = 'ok';
      expect(await notifications.dispatch()).toEqual({ sent: 1, failed: 0 });
    });

    it('gives up after enough attempts instead of trying forever', async () => {
      expo.behaviour = 'transient';
      for (let i = 0; i < 5; i += 1) await notifications.dispatch();
      expect(await prisma.notification.findFirstOrThrow({})).toMatchObject({ status: 'FAILED' });
    });

    it('records a failure when the patient has no device, and stops', async () => {
      await prisma.pushToken.deleteMany({});
      expect(await notifications.dispatch()).toEqual({ sent: 0, failed: 1 });
      expect(await prisma.notification.findFirstOrThrow({})).toMatchObject({
        status: 'FAILED',
        lastError: 'no registered device',
      });
    });
  });

  // -------------------------------------------------------------------------

  describe('turning events into messages (P8-BE-02)', () => {
    const notifier = () => app.get(EventNotifier);

    it('notifies from the timeline, not from inside the command', async () => {
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(staff.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);
      await http().post(`/sessions/${sessionId}/call-next`).set(auth(staff.accessToken)).send({}).expect(201);

      expect(await notifier().notifyFromEvents()).toBeGreaterThan(0);
      const types = (await prisma.notification.findMany({})).map((n) => n.type);
      expect(types).toContain('CALLED');
    });

    it('is safe to run repeatedly - the timeline does not move, so nothing repeats', async () => {
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(staff.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);
      await http().post(`/sessions/${sessionId}/call-next`).set(auth(staff.accessToken)).send({}).expect(201);

      await notifier().notifyFromEvents();
      const first = await prisma.notification.count();
      await notifier().notifyFromEvents();
      await notifier().notifyFromEvents();
      expect(await prisma.notification.count()).toBe(first);
    });

    it('says nothing to a walk-in, who has no app and never asked', async () => {
      await http()
        .post(`/sessions/${sessionId}/walk-in`)
        .set(auth(staff.accessToken))
        .send({ name: 'Desk Patient' })
        .expect(201);
      await http().post(`/sessions/${sessionId}/call-next`).set(auth(staff.accessToken)).send({}).expect(201);

      await notifier().notifyFromEvents();
      const walkIn = await prisma.queueEntry.findFirstOrThrow({ where: { type: 'WALK_IN' } });
      expect(await prisma.notification.count({ where: { entryId: walkIn.id } })).toBe(0);
    });

    it('stays silent about things a patient cannot act on', async () => {
      // A pause, a presence change and a priority edit are all deliberately quiet.
      await http()
        .post(`/sessions/${sessionId}/presence`)
        .set(auth(staff.accessToken))
        .send({ presence: 'PRESENT' })
        .expect(201);
      await http()
        .post(`/sessions/${sessionId}/priority`)
        .set(auth(staff.accessToken))
        .send({ entryId, priority: 'PRIORITY', reason: 'elderly patient' })
        .expect(201);

      await notifier().notifyFromEvents();
      expect(await prisma.notification.count()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------

  describe('"time to leave" (P8-BE-02)', () => {
    const leaveNow = () => app.get(LeaveNowNotifier);

    it('tells a booked patient to set off when their turn is near', async () => {
      const told = await leaveNow().nudge();
      expect(told).toContain(entryId);
      const row = await prisma.notification.findFirstOrThrow({ where: { type: 'LEAVE_NOW' } });
      expect(row.title.toLowerCase()).toContain('notify hospital');
    });

    it('tells them ONCE, however often the sweep runs', async () => {
      await leaveNow().nudge();
      await leaveNow().nudge();
      await leaveNow().nudge();
      expect(await prisma.notification.count({ where: { type: 'LEAVE_NOW' } })).toBe(1);
    });

    it('writes down the window it promised, so the estimate can be graded later', async () => {
      // The ETA is computed on demand and thrown away everywhere else. Here it stops
      // being a number and becomes a commitment somebody puts their shoes on for, so
      // it is recorded - `calledAt` already is, and the pair is the only way to ask
      // afterwards whether we kept our word.
      await leaveNow().nudge();

      const entry = await prisma.queueEntry.findFirstOrThrow({ where: { id: entryId } });
      expect(entry.predictedCallFrom).not.toBeNull();
      expect(entry.predictedCallTo).not.toBeNull();
      expect(entry.predictedCallTo!.getTime()).toBeGreaterThan(entry.predictedCallFrom!.getTime());
    });

    it('never rewrites the promise on a later sweep', async () => {
      // A second nudge must not replace the window the patient actually saw with a
      // fresher, more flattering one - that would make the record unfalsifiable by
      // always agreeing with the present.
      await leaveNow().nudge();
      const first = await prisma.queueEntry.findFirstOrThrow({ where: { id: entryId } });

      await leaveNow().nudge();
      const second = await prisma.queueEntry.findFirstOrThrow({ where: { id: entryId } });

      expect(second.predictedCallFrom!.getTime()).toBe(first.predictedCallFrom!.getTime());
      expect(second.predictedCallTo!.getTime()).toBe(first.predictedCallTo!.getTime());
    });

    it('leaves the promise null for anyone never nudged', async () => {
      // Null means "we never told them anything", which is honest. Scoring those as
      // a miss would blame the engine for patients it never spoke to.
      const person = await prisma.patient.create({ data: { name: 'Never told' } });
      const quiet = await prisma.queueEntry.create({
        data: {
          hospitalId,
          sessionId,
          patientId: person.id,
          tokenNumber: 900,
          tokenLabel: 'A900',
          type: 'WALK_IN',
          status: 'CHECKED_IN',
        },
      });

      await leaveNow().nudge();

      const row = await prisma.queueEntry.findFirstOrThrow({ where: { id: quiet.id } });
      expect(row.predictedCallFrom).toBeNull();
      expect(row.predictedCallTo).toBeNull();
    });

    it('says nothing while the wait is longer than the hospital asks them to allow', async () => {
      // Twenty people ahead at ten minutes each is over three hours; nobody should
      // be told to leave the house for that.
      const person = await prisma.patient.create({ data: { name: 'Filler' } });
      await prisma.queueEntry.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({
          hospitalId,
          sessionId,
          patientId: person.id,
          tokenNumber: 100 + i,
          tokenLabel: `A${100 + i}`,
          type: 'WALK_IN' as const,
          status: 'CHECKED_IN' as const,
        })),
      });

      expect(await leaveNow().nudge()).toEqual([]);
      expect(await prisma.notification.count({ where: { type: 'LEAVE_NOW' } })).toBe(0);
    });

    it('says nothing to somebody already standing in the corridor', async () => {
      await app.get(QueueService); // module is live
      await http()
        .post(`/sessions/${sessionId}/check-in`)
        .set(auth(staff.accessToken))
        .send({ tokenNumber: 1 })
        .expect(201);

      expect(await leaveNow().nudge()).toEqual([]);
    });

    it('says nothing while the queue is paused or the doctor has gone', async () => {
      await prisma.oPDSession.update({ where: { id: sessionId }, data: { doctorPresence: 'LEFT' } });
      expect(await leaveNow().nudge()).toEqual([]);

      await prisma.oPDSession.update({
        where: { id: sessionId },
        data: { doctorPresence: 'PRESENT', status: 'ACTIVE', pausedAt: new Date() },
      });
      expect(await leaveNow().nudge()).toEqual([]);
    });
  });
});
