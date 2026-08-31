import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDb } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { QueueService, type QueueActor } from '../src/modules/queue/queue.service';
import { dateColumnFromString } from '../src/common/ist';
import { checkIn } from '../src/modules/queue/commands/check-in';
import { callNext } from '../src/modules/queue/commands/call-next';
import { startConsultation } from '../src/modules/queue/commands/start-consultation';
import { completeConsultation } from '../src/modules/queue/commands/complete-consultation';
import { skip } from '../src/modules/queue/commands/skip';
import { noShow } from '../src/modules/queue/commands/no-show';
import { requeue } from '../src/modules/queue/commands/requeue';
import { endSession } from '../src/modules/queue/commands/end-session';
import { walkIn } from '../src/modules/queue/commands/walk-in';
import { setPriority } from '../src/modules/queue/commands/priority';
import { pause, resume } from '../src/modules/queue/commands/pause';
import { presence } from '../src/modules/queue/commands/presence';
import {
  DoctorHasLeftError,
  NoEligiblePatientError,
  QueuePausedError,
} from '../src/common/errors';

/**
 * P4-TEST-01 - the scenario and concurrency suite.
 *
 * The four claims docs/Phases.md names verbatim, plus the full-session walkthrough
 * from the phase's integration checkpoint. These are the assertions that decide
 * whether the engine is correct; the state-machine unit tests only decide whether it
 * is consistent.
 */
describe('queue scenarios (P4-TEST-01)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: QueueService;

  let hospitalId: string;
  let departmentId: string;
  let doctorId: string;
  let sessionId: string;
  let actor: QueueActor;

  /** Books an ONLINE patient who is at home: CONFIRMED, not yet arrived. */
  async function book(name: string, tokenNumber: number): Promise<string> {
    const patient = await prisma.patient.create({ data: { name, accountId: null } });
    const entry = await prisma.queueEntry.create({
      data: {
        hospitalId,
        sessionId,
        patientId: patient.id,
        tokenNumber,
        tokenLabel: `A${String(tokenNumber).padStart(3, '0')}`,
        type: 'ONLINE',
        status: 'CONFIRMED',
      },
    });
    return entry.id;
  }

  const statusOf = async (entryId: string) =>
    (await prisma.queueEntry.findUniqueOrThrow({ where: { id: entryId } })).status;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    queue = app.get(QueueService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);

    hospitalId = (
      await prisma.hospital.create({
        data: { name: 'Scenario Hospital', city: 'Mumbai', status: 'VERIFIED' },
      })
    ).id;
    departmentId = (await prisma.department.create({ data: { hospitalId, name: 'Cardiology' } })).id;
    doctorId = (await prisma.doctor.create({ data: { hospitalId, departmentId, name: 'Dr Q' } })).id;

    const start = new Date();
    sessionId = (
      await prisma.oPDSession.create({
        data: {
          hospitalId,
          departmentId,
          originalDoctorId: doctorId,
          currentProviderDoctorId: doctorId,
          date: dateColumnFromString(new Date().toISOString().slice(0, 10)),
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + 3 * 60 * 60 * 1000),
          feePaise: 50_000,
          status: 'OPEN_FOR_REGISTRATION',
        },
      })
    ).id;

    actor = { accountId: null, hospitalId, type: 'SYSTEM' };
  });

  // -------------------------------------------------------------------------
  // (1) two concurrent call-next calls never serve the same entry
  // -------------------------------------------------------------------------

  it('never serves the same patient to two concurrent call-next calls', async () => {
    const a = await book('Ann', 1);
    const b = await book('Bob', 2);
    await checkIn(queue, sessionId, actor, { tokenNumber: 1 });
    await checkIn(queue, sessionId, actor, { tokenNumber: 2 });

    // The doctor console double-fires. Exactly one may win: the second call arrives
    // while Ann is still CALLED, and calling anyone while a patient is with the
    // doctor is refused - so it is rejected rather than quietly serving Bob too.
    const results = await Promise.allSettled([
      callNext(queue, sessionId, actor),
      callNext(queue, sessionId, actor),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1);

    const called = await prisma.queueEntry.findMany({ where: { sessionId, status: 'CALLED' } });
    expect(called).toHaveLength(1);
    expect(called[0].id).toBe(a);
    expect(await statusOf(b)).toBe('CHECKED_IN');
  });

  // -------------------------------------------------------------------------
  // (2) 10 booked, 3 checked in - the doctor never idles for the other 7
  // -------------------------------------------------------------------------

  it('offers one of the checked-in three and never idles for the seven still at home', async () => {
    const ids: string[] = [];
    for (let token = 1; token <= 10; token += 1) {
      ids.push(await book(`Patient ${token}`, token));
    }

    // Tokens 4, 7 and 9 have arrived. 1-3, 5, 6, 8 and 10 are still at home, and
    // several of them booked EARLIER - which is exactly the trap: token order must
    // not reach past someone's front door (docs/PRD.md 8.2).
    for (const token of [4, 7, 9]) {
      await checkIn(queue, sessionId, actor, { tokenNumber: token });
    }

    const first = await callNext(queue, sessionId, actor);
    expect(first.entry?.tokenNumber).toBe(4);

    await startConsultation(queue, sessionId, actor, { entryId: first.entry!.id });
    await completeConsultation(queue, sessionId, actor, { entryId: first.entry!.id });

    const second = await callNext(queue, sessionId, actor);
    expect(second.entry?.tokenNumber).toBe(7);

    await startConsultation(queue, sessionId, actor, { entryId: second.entry!.id });
    await completeConsultation(queue, sessionId, actor, { entryId: second.entry!.id });

    const third = await callNext(queue, sessionId, actor);
    expect(third.entry?.tokenNumber).toBe(9);

    await startConsultation(queue, sessionId, actor, { entryId: third.entry!.id });
    await completeConsultation(queue, sessionId, actor, { entryId: third.entry!.id });

    // Nobody else has arrived: the queue is empty of eligible patients, and that is
    // reported as "nobody has checked in", not as an error in the queue.
    await expect(callNext(queue, sessionId, actor)).rejects.toBeInstanceOf(NoEligiblePatientError);

    // The seven are untouched - not called, not skipped, not no-showed.
    for (const token of [1, 2, 3, 5, 6, 8, 10]) {
      const entry = await prisma.queueEntry.findFirstOrThrow({ where: { sessionId, tokenNumber: token } });
      expect(entry.status).toBe('CONFIRMED');
      expect(ids).toContain(entry.id);
    }
  });

  // -------------------------------------------------------------------------
  // (3) a late check-in slots into its natural token position
  // -------------------------------------------------------------------------

  it('slots a late arrival into its token position among those already waiting', async () => {
    await book('Token 2', 2);
    await book('Token 5', 5);
    await book('Token 8', 8);

    // 5 and 8 arrive first. 2 - who booked earliest - turns up afterwards.
    await checkIn(queue, sessionId, actor, { tokenNumber: 5 });
    await checkIn(queue, sessionId, actor, { tokenNumber: 8 });
    await checkIn(queue, sessionId, actor, { tokenNumber: 2 });

    // Token order, not arrival order: 2 goes first despite arriving last, because
    // their token never changed and the order is computed from it (docs/PRD.md 8.4).
    const order: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await callNext(queue, sessionId, actor);
      order.push(result.entry!.tokenNumber);
      await startConsultation(queue, sessionId, actor, { entryId: result.entry!.id });
      await completeConsultation(queue, sessionId, actor, { entryId: result.entry!.id });
    }

    expect(order).toEqual([2, 5, 8]);
  });

  // -------------------------------------------------------------------------
  // (4) an emergency does not corrupt everyone else's relative order
  // -------------------------------------------------------------------------

  it('puts an emergency first without disturbing the order of anyone else', async () => {
    for (let token = 1; token <= 5; token += 1) {
      await book(`Patient ${token}`, token);
      await checkIn(queue, sessionId, actor, { tokenNumber: token });
    }

    const four = await prisma.queueEntry.findFirstOrThrow({ where: { sessionId, tokenNumber: 4 } });
    await setPriority(queue, sessionId, actor, {
      entryId: four.id,
      priority: 'EMERGENCY',
      reason: 'chest pain, triaged by duty doctor',
    });

    // A second escalation, to prove two emergencies resolve in escalation order
    // rather than token order.
    const two = await prisma.queueEntry.findFirstOrThrow({ where: { sessionId, tokenNumber: 2 } });
    await setPriority(queue, sessionId, actor, {
      entryId: two.id,
      priority: 'EMERGENCY',
      reason: 'second emergency, arrived after',
    });

    const order: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const result = await callNext(queue, sessionId, actor);
      order.push(result.entry!.tokenNumber);
      await startConsultation(queue, sessionId, actor, { entryId: result.entry!.id });
      await completeConsultation(queue, sessionId, actor, { entryId: result.entry!.id });
    }

    // 4 then 2 (escalation order), then 1, 3, 5 in their original relative order -
    // unshifted, unrenumbered, exactly as they were.
    expect(order).toEqual([4, 2, 1, 3, 5]);

    // The escalation is on the record, with its reason.
    const audit = await prisma.auditLog.findMany({
      where: { hospitalId, action: 'queue.SET_PRIORITY' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0].reason).toBe('chest pain, triaged by duty doctor');
  });

  // -------------------------------------------------------------------------
  // The integration checkpoint: a full session end to end
  // -------------------------------------------------------------------------

  it('runs a whole session: check-in, consult, no-show, walk-in, end', async () => {
    const ann = await book('Ann', 1);
    const bob = await book('Bob', 2);
    const cara = await book('Cara', 3);

    await checkIn(queue, sessionId, actor, { tokenNumber: 1 });
    await checkIn(queue, sessionId, actor, { tokenNumber: 2 });

    // A walk-in joins at the end of the token order and is present immediately.
    const walkin = await walkIn(queue, sessionId, actor, { name: 'Dev Walk-in' });
    expect(walkin.entry?.tokenNumber).toBe(4);
    expect(walkin.entry?.status).toBe('CHECKED_IN');
    expect(walkin.entry?.type).toBe('WALK_IN');

    // Ann is seen.
    const callAnn = await callNext(queue, sessionId, actor);
    expect(callAnn.entry?.id).toBe(ann);
    // Calling the first patient is what starts the session.
    expect(callAnn.sessionStatus).toBe('ACTIVE');
    await startConsultation(queue, sessionId, actor, { entryId: ann });
    await completeConsultation(queue, sessionId, actor, { entryId: ann });

    // Bob is called and does not appear: skipped, then requeued when he turns up,
    // then finally written off.
    const callBob = await callNext(queue, sessionId, actor);
    expect(callBob.entry?.id).toBe(bob);
    await skip(queue, sessionId, actor, { entryId: bob, reason: 'no response at the door' });
    expect(await statusOf(bob)).toBe('SKIPPED');

    await requeue(queue, sessionId, actor, { entryId: bob });
    expect(await statusOf(bob)).toBe('CHECKED_IN');

    // The doctor takes a break: no new patients while paused.
    await pause(queue, sessionId, actor, { reason: 'tea' });
    await expect(callNext(queue, sessionId, actor)).rejects.toBeInstanceOf(QueuePausedError);
    await resume(queue, sessionId, actor, {});

    // The WALK-IN is next, not Bob - even though Bob's token (2) beats the walk-in's
    // (4). That is docs/PRD.md 8.8's "move to end": a requeued patient goes behind
    // everyone who has not been sent to the back. Ordering Bob by his original token
    // would hand him straight back to the doctor as the next patient, which is the
    // loop the grace period exists to stop.
    const callWalkin = await callNext(queue, sessionId, actor);
    expect(callWalkin.entry?.id).toBe(walkin.entry!.id);
    await startConsultation(queue, sessionId, actor, { entryId: walkin.entry!.id });
    await completeConsultation(queue, sessionId, actor, { entryId: walkin.entry!.id });

    // Now Bob's turn comes round again, and he is still not there.
    const callBobAgain = await callNext(queue, sessionId, actor);
    expect(callBobAgain.entry?.id).toBe(bob);
    await skip(queue, sessionId, actor, { entryId: bob });
    await noShow(queue, sessionId, actor, { entryId: bob });
    expect(await statusOf(bob)).toBe('NO_SHOW');

    // End the session. Cara never arrived; nobody is left who was present.
    const ended = await endSession(queue, sessionId, actor, { reason: 'clinic over' });
    expect(ended.sessionStatus).toBe('ENDED_EARLY');
    expect(await statusOf(cara)).toBe('NO_SHOW');

    // Two consultations were recorded, and both are attributed to the provider.
    const consultations = await prisma.consultation.findMany({ where: { hospitalId } });
    expect(consultations).toHaveLength(2);
    expect(consultations.every((c) => c.doctorId === doctorId)).toBe(true);
    expect(consultations.every((c) => c.durationSec >= 1)).toBe(true);
  });

  it('sends a requeued patient to the back, behind everyone who was not requeued', async () => {
    // Tokens 1-4, all present. 1 is called, does not appear, is skipped and returns.
    for (let token = 1; token <= 4; token += 1) {
      await book(`Patient ${token}`, token);
      await checkIn(queue, sessionId, actor, { tokenNumber: token });
    }

    const first = await callNext(queue, sessionId, actor);
    expect(first.entry?.tokenNumber).toBe(1);
    await skip(queue, sessionId, actor, { entryId: first.entry!.id });
    await requeue(queue, sessionId, actor, { entryId: first.entry!.id });

    const order: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const result = await callNext(queue, sessionId, actor);
      order.push(result.entry!.tokenNumber);
      await startConsultation(queue, sessionId, actor, { entryId: result.entry!.id });
      await completeConsultation(queue, sessionId, actor, { entryId: result.entry!.id });
    }

    // Token 1 goes LAST despite holding the earliest token. Ordering them by token
    // would offer the same absent patient again immediately, forever.
    expect(order).toEqual([2, 3, 4, 1]);
  });

  it('keeps two requeued patients in the order they came back', async () => {
    for (let token = 1; token <= 3; token += 1) {
      await book(`Patient ${token}`, token);
      await checkIn(queue, sessionId, actor, { tokenNumber: token });
    }

    const one = await prisma.queueEntry.findFirstOrThrow({ where: { sessionId, tokenNumber: 1 } });
    const two = await prisma.queueEntry.findFirstOrThrow({ where: { sessionId, tokenNumber: 2 } });

    // 2 is skipped and returns first; 1 is skipped and returns after.
    const callTwo = await callNext(queue, sessionId, actor);
    expect(callTwo.entry?.tokenNumber).toBe(1);
    await skip(queue, sessionId, actor, { entryId: one.id });

    const callOne = await callNext(queue, sessionId, actor);
    expect(callOne.entry?.tokenNumber).toBe(2);
    await skip(queue, sessionId, actor, { entryId: two.id });

    await requeue(queue, sessionId, actor, { entryId: two.id });
    await requeue(queue, sessionId, actor, { entryId: one.id });

    const order: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await callNext(queue, sessionId, actor);
      order.push(result.entry!.tokenNumber);
      await startConsultation(queue, sessionId, actor, { entryId: result.entry!.id });
      await completeConsultation(queue, sessionId, actor, { entryId: result.entry!.id });
    }

    // 3 was never requeued so goes first; then 2 and 1 in the order they returned,
    // NOT in token order.
    expect(order).toEqual([3, 2, 1]);
  });

  it('will not call another patient once the doctor is marked as having left', async () => {
    await book('Waiting', 1);
    await book('Also waiting', 2);
    await checkIn(queue, sessionId, actor, { tokenNumber: 1 });
    await checkIn(queue, sessionId, actor, { tokenNumber: 2 });

    const first = await callNext(queue, sessionId, actor);
    await startConsultation(queue, sessionId, actor, { entryId: first.entry!.id });
    await completeConsultation(queue, sessionId, actor, { entryId: first.entry!.id });

    // The doctor goes home without ending the session - the mistake this guards.
    await presence(queue, sessionId, actor, { presence: 'LEFT' });
    await expect(callNext(queue, sessionId, actor)).rejects.toBeInstanceOf(DoctorHasLeftError);

    // Being late or on a break must NOT block the queue (docs/PRD.md 8.11).
    await presence(queue, sessionId, actor, { presence: 'ON_BREAK' });
    const onBreak = await callNext(queue, sessionId, actor);
    expect(onBreak.entry?.tokenNumber).toBe(2);
  });

  it('reschedules the people who were present when a session ends early', async () => {
    const present = await book('Present', 1);
    const athome = await book('At home', 2);
    await checkIn(queue, sessionId, actor, { tokenNumber: 1 });

    await endSession(queue, sessionId, actor, { reason: 'doctor called away' });

    // The distinction docs/PRD.md 8.9 and 8.11 each describe one half of: someone
    // who took the afternoon off and came in is not a no-show.
    expect(await statusOf(present)).toBe('RESCHEDULED');
    expect(await statusOf(athome)).toBe('NO_SHOW');
  });

  it('refuses to end a session while a patient is with the doctor', async () => {
    const ann = await book('Ann', 1);
    await checkIn(queue, sessionId, actor, { tokenNumber: 1 });
    await callNext(queue, sessionId, actor);
    await startConsultation(queue, sessionId, actor, { entryId: ann });

    await expect(endSession(queue, sessionId, actor, {})).rejects.toThrow(
      /Cannot END_SESSION from IN_CONSULTATION/,
    );

    // Complete them first, and it ends cleanly.
    await completeConsultation(queue, sessionId, actor, { entryId: ann });
    const ended = await endSession(queue, sessionId, actor, {});
    expect(ended.sessionStatus).toBe('ENDED_EARLY');
  });

  it('is idempotent about check-in, because staff double-scan', async () => {
    const ann = await book('Ann', 1);
    const first = await checkIn(queue, sessionId, actor, { tokenNumber: 1 });
    const at = (await prisma.queueEntry.findUniqueOrThrow({ where: { id: ann } })).checkedInAt;

    const second = await checkIn(queue, sessionId, actor, { tokenNumber: 1 });
    expect(second.entry?.status).toBe('CHECKED_IN');
    expect(first.entry?.status).toBe('CHECKED_IN');

    // The arrival time is not re-stamped, and the second scan writes no event.
    const after = await prisma.queueEntry.findUniqueOrThrow({ where: { id: ann } });
    expect(after.checkedInAt?.toISOString()).toBe(at?.toISOString());
    expect(await prisma.queueEvent.count({ where: { sessionId, type: 'ENTRY_CHECKED_IN' } })).toBe(1);
  });

  it('gives every walk-in its own token number under concurrency', async () => {
    // Two receptionists register a walk-in at the same instant. The session lock
    // serialises them; unique(sessionId, tokenNumber) is the second line of defence.
    const results = await Promise.all([
      walkIn(queue, sessionId, actor, { name: 'First' }),
      walkIn(queue, sessionId, actor, { name: 'Second' }),
    ]);

    const tokens = results.map((r) => r.entry!.tokenNumber).sort();
    expect(tokens).toEqual([1, 2]);
  });

  it('writes an audit log and a queue event for every queue-affecting action', async () => {
    const ann = await book('Ann', 1);
    await checkIn(queue, sessionId, actor, { tokenNumber: 1 });
    await callNext(queue, sessionId, actor);
    await startConsultation(queue, sessionId, actor, { entryId: ann });
    await completeConsultation(queue, sessionId, actor, { entryId: ann });

    const events = await prisma.queueEvent.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    const types = events.map((e) => e.type);
    expect(types).toContain('ENTRY_CHECKED_IN');
    expect(types).toContain('SESSION_ACTIVATED');
    expect(types).toContain('ENTRY_CALLED');
    expect(types).toContain('ENTRY_CONSULTATION_STARTED');
    expect(types).toContain('ENTRY_CONSULTATION_COMPLETED');

    // docs/Rules.md 1.7 - one audit row for every event row.
    const audits = await prisma.auditLog.count({ where: { hospitalId } });
    expect(audits).toBe(events.length);
  });
});
