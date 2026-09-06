import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, resetDb } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueService, type QueueActor } from '../src/modules/queue/queue.service';
import { dateColumnFromString, istToday } from '../src/common/ist';
import {
  InvalidQueueTransitionError,
  NotFoundError,
  QueuePausedError,
  TenantMismatchError,
} from '../src/common/errors';

/**
 * P4-BE-02 done-when: "lock serializes two txns; event+audit atomic".
 *
 * These run against a real Postgres, because that is the only place the claim can
 * be tested at all: `SELECT ... FOR UPDATE` does nothing in a unit test with a
 * mocked client, and a mocked client will happily "serialise" whatever you tell it
 * to. docs/Rules.md 12.
 */
describe('queue command skeleton (P4-BE-02)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: QueueService;

  let hospitalId: string;
  let otherHospitalId: string;
  let sessionId: string;
  let actor: QueueActor;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    queue = app.get(QueueService);
    await resetDb(prisma);

    const hospital = async (name: string) =>
      (await prisma.hospital.create({ data: { name, city: 'Mumbai', status: 'VERIFIED' } })).id;

    hospitalId = await hospital('Lock Test Hospital');
    otherHospitalId = await hospital('Someone Else Entirely');

    const departmentId = (
      await prisma.department.create({ data: { hospitalId, name: 'Cardiology' } })
    ).id;
    const doctorId = (
      await prisma.doctor.create({ data: { hospitalId, departmentId, name: 'Dr Lock' } })
    ).id;

    const start = new Date();
    sessionId = (
      await prisma.oPDSession.create({
        data: {
          hospitalId,
          departmentId,
          originalDoctorId: doctorId,
          currentProviderDoctorId: doctorId,
          // istToday(), NOT toISOString().slice(0,10): the second is the UTC day, and
          // between 00:00 and 05:30 IST that is YESTERDAY. Every fixture here stamped
          // sessions with the wrong calendar date for five and a half hours a day, so
          // discovery - which filters on the IST day - returned nothing and the suite
          // failed only if you happened to run it after midnight.
          date: dateColumnFromString(istToday()),
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + 3 * 60 * 60 * 1000),
          feePaise: 50_000,
          status: 'OPEN_FOR_REGISTRATION',
          // Explicit rather than relying on the NOT_PRESENT default. The paused-queue
          // test below expects QueuePausedError from a CALL_NEXT, and it got it only
          // because the pause guard happens to run BEFORE the presence guard. That is
          // a true fact about the order, not something this test meant to assert.
          doctorPresence: 'PRESENT',
        },
      })
    ).id;

    actor = { accountId: null, hospitalId, type: 'SYSTEM' };
  });

  afterAll(async () => {
    await app.close();
  });

  it('serialises two concurrent commands on the same session', async () => {
    // Each command reads the version, waits, then writes a marker built from what it
    // read. WITHOUT the lock both read the same version and the second overwrites the
    // first - the classic lost update, and exactly how two staff double-serve one
    // patient. WITH it, the second blocks until the first commits and sees its work.
    const order: string[] = [];

    const command = (label: string, holdMs: number) =>
      queue.runCommand({
        sessionId,
        actor,
        command: 'PRESENCE',
        handler: async (ctx) => {
          order.push(`${label}:read@${ctx.session.version}`);
          await new Promise((resolve) => setTimeout(resolve, holdMs));
          ctx.record({ type: 'DOCTOR_PRESENCE_CHANGED', metadata: { label } });
          order.push(`${label}:done`);
          return ctx.session.version;
        },
      });

    const [first, second] = await Promise.all([command('A', 300), command('B', 0)]);

    // Neither read the same version: they ran one after the other, not side by side.
    expect(new Set([first, second]).size).toBe(2);
    expect(Math.abs(first - second)).toBe(1);

    // Whichever won the lock ran to completion before the other read anything.
    // Deliberately order-agnostic: which of the two acquires the lock first is a
    // race, and asserting a winner is how this test would start failing once a
    // month for no reason. The claim under test is non-INTERLEAVING, not order -
    // without the lock this reads read/read/done/done and fails.
    expect(order).toHaveLength(4);
    const winner = order[0].startsWith('A') ? 'A' : 'B';
    const loser = winner === 'A' ? 'B' : 'A';
    expect(order[0]).toBe(`${winner}:read@0`);
    expect(order[1]).toBe(`${winner}:done`);
    expect(order[2]).toBe(`${loser}:read@1`);
    expect(order[3]).toBe(`${loser}:done`);

    const session = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.version).toBe(2);
  });

  it('bumps the version once per command, even when the command changes nothing else', async () => {
    const before = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });

    await queue.runCommand({
      sessionId,
      actor,
      command: 'PRESENCE',
      handler: async (ctx) => {
        ctx.patchSession({ doctorPresence: 'PRESENT' });
        ctx.record({ type: 'DOCTOR_PRESENCE_CHANGED' });
      },
    });

    const after = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(after.version).toBe(before.version + 1);
    expect(after.doctorPresence).toBe('PRESENT');
  });

  it('writes the queue event and the audit log together, or not at all', async () => {
    const eventsBefore = await prisma.queueEvent.count({ where: { sessionId } });
    const auditsBefore = await prisma.auditLog.count({ where: { hospitalId } });

    await expect(
      queue.runCommand({
        sessionId,
        actor,
        command: 'PRESENCE',
        reason: 'stepped out',
        handler: async (ctx) => {
          ctx.record({ type: 'DOCTOR_PRESENCE_CHANGED', metadata: { to: 'ON_BREAK' } });
          throw new Error('boom, after the record but before commit');
        },
      }),
    ).rejects.toThrow('boom');

    // An action that did not happen must not be recorded as if it did.
    expect(await prisma.queueEvent.count({ where: { sessionId } })).toBe(eventsBefore);
    expect(await prisma.auditLog.count({ where: { hospitalId } })).toBe(auditsBefore);

    // ...and the version did not move either.
    const session = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(session.version).toBe(2 + 1); // two from the race, one from the bump test

    // The same command, allowed to finish, writes exactly one of each.
    await queue.runCommand({
      sessionId,
      actor,
      command: 'PRESENCE',
      reason: 'stepped out',
      handler: async (ctx) => {
        ctx.record({ type: 'DOCTOR_PRESENCE_CHANGED', metadata: { to: 'ON_BREAK' } });
      },
    });

    expect(await prisma.queueEvent.count({ where: { sessionId } })).toBe(eventsBefore + 1);
    expect(await prisma.auditLog.count({ where: { hospitalId } })).toBe(auditsBefore + 1);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { hospitalId },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.action).toBe('queue.PRESENCE');
    expect(audit.entityType).toBe('OPDSession');
    expect(audit.entityId).toBe(sessionId);
    expect(audit.reason).toBe('stepped out');
    expect(audit.actorType).toBe('SYSTEM');
    expect(audit.actorId).toBeNull();
  });

  it('refuses a session belonging to another hospital, and says nothing about it', async () => {
    await expect(
      queue.runCommand({
        sessionId,
        actor: { ...actor, hospitalId: otherHospitalId },
        command: 'PRESENCE',
        handler: async () => 'should not run',
      }),
    ).rejects.toBeInstanceOf(TenantMismatchError);
  });

  it('404s an unknown session rather than opening a transaction that does nothing', async () => {
    await expect(
      queue.runCommand({
        sessionId: '00000000-0000-4000-8000-000000000000',
        actor,
        command: 'PRESENCE',
        handler: async () => 'should not run',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('runs the state machine before the handler, not after', async () => {
    let handlerRan = false;

    // CALL_NEXT is not accepted while the queue is paused (docs/PRD.md 6.2).
    await prisma.oPDSession.update({
      where: { id: sessionId },
      data: { status: 'ACTIVE', pausedAt: new Date() },
    });

    await expect(
      queue.runCommand({
        sessionId,
        actor,
        command: 'CALL_NEXT',
        handler: async () => {
          handlerRan = true;
        },
      }),
    ).rejects.toBeInstanceOf(QueuePausedError);
    expect(handlerRan).toBe(false);

    // ...and a command the session status forbids outright.
    await prisma.oPDSession.update({
      where: { id: sessionId },
      data: { status: 'COMPLETED', pausedAt: null },
    });

    await expect(
      queue.runCommand({
        sessionId,
        actor,
        command: 'CHECK_IN',
        handler: async () => {
          handlerRan = true;
        },
      }),
    ).rejects.toBeInstanceOf(InvalidQueueTransitionError);
    expect(handlerRan).toBe(false);
  });

  it('will not fetch an entry that belongs to a different session', async () => {
    await prisma.oPDSession.update({
      where: { id: sessionId },
      data: { status: 'OPEN_FOR_REGISTRATION' },
    });

    const patient = await prisma.patient.create({
      data: { name: 'Walk In', accountId: null },
    });

    // A second session in the SAME hospital - so only the session check can catch it.
    const session = await prisma.oPDSession.findUniqueOrThrow({ where: { id: sessionId } });
    const otherSession = await prisma.oPDSession.create({
      data: {
        hospitalId,
        departmentId: session.departmentId,
        originalDoctorId: session.originalDoctorId,
        currentProviderDoctorId: session.currentProviderDoctorId,
        date: session.date,
        scheduledStart: new Date(session.scheduledStart.getTime() + 4 * 60 * 60 * 1000),
        scheduledEnd: new Date(session.scheduledEnd.getTime() + 4 * 60 * 60 * 1000),
        feePaise: 50_000,
        status: 'OPEN_FOR_REGISTRATION',
      },
    });

    const foreign = await prisma.queueEntry.create({
      data: {
        hospitalId,
        sessionId: otherSession.id,
        patientId: patient.id,
        tokenNumber: 1,
        tokenLabel: 'A001',
        type: 'WALK_IN',
        status: 'CHECKED_IN',
      },
    });

    await expect(
      queue.runCommand({
        sessionId,
        actor,
        command: 'CHECK_IN',
        handler: async (ctx) => ctx.entryInSession(foreign.id),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
