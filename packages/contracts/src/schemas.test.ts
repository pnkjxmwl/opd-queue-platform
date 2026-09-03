import { describe, expect, it } from 'vitest';
import { Email, LoginRequest, Password, SignupRequest } from './auth/dto';
import { CreatePatientRequest } from './patients/dto';
import {
  EntryUpdatedEvent,
  SessionUpdatedEvent,
  SubscribeRequest,
  accountRoom,
  sessionRoom,
} from './realtime/dto';
import { DeadTimeBasis, EtaBasis, SessionEta } from './eta/dto';
import {
  CancellationRules,
  ClockTime,
  ConfigListQuery,
  CreateDoctorScheduleRequest,
  CreateOPDSessionRequest,
  DEFAULT_QUEUE_POLICY,
  InviteStaffRequest,
  QueuePolicyFields,
  SessionListQuery,
  UpdateDoctorRequest,
} from './config/dto';
import { PageQuery } from './common/pagination';
import {
  DepartmentListQuery,
  DoctorSearchQuery,
  HospitalSearchQuery,
  QueueSnapshot,
  SessionCard,
  SessionCardQuery,
} from './discovery/dto';

describe('auth schemas', () => {
  it('normalises email to trimmed lowercase', () => {
    expect(Email.parse('  Mixed.Case@Example.COM ')).toBe('mixed.case@example.com');
  });

  it('rejects a malformed email', () => {
    expect(Email.safeParse('not-an-email').success).toBe(false);
  });

  it('enforces a minimum password length on signup', () => {
    expect(Password.safeParse('short').success).toBe(false);
    expect(Password.safeParse('correct-horse-battery').success).toBe(true);
  });

  it('does NOT enforce the password policy on login', () => {
    // Applying signup's length rule here would leak the policy and reject
    // legacy passwords before the credentials are even checked.
    expect(LoginRequest.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
  });

  it('accepts an optional name on signup', () => {
    expect(SignupRequest.parse({ email: 'a@b.com', password: 'correct-horse-battery' }).name)
      .toBeUndefined();
  });
});

describe('patient schemas', () => {
  const base = { name: 'Asha' };

  it('defaults relation to SELF', () => {
    expect(CreatePatientRequest.parse(base).relation).toBe('SELF');
  });

  it('rejects a date of birth in the future', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const result = CreatePatientRequest.safeParse({ ...base, dob: tomorrow });
    expect(result.success).toBe(false);
  });

  it('accepts a past date of birth', () => {
    expect(CreatePatientRequest.safeParse({ ...base, dob: '2015-04-02T00:00:00.000Z' }).success)
      .toBe(true);
  });

  it('rejects an empty name', () => {
    expect(CreatePatientRequest.safeParse({ name: '   ' }).success).toBe(false);
  });
});

describe('queue policy (frozen Phase-2 shape)', () => {
  it('produces a complete policy from an empty object', () => {
    // The engine must never meet a half-filled policy, and a hospital that has
    // never opened the config screen still has to run a queue.
    const parsed = QueuePolicyFields.parse({});
    for (const [key, value] of Object.entries(parsed)) {
      expect(value, `${key} has no default`).not.toBeUndefined();
    }
    expect(parsed).toEqual(DEFAULT_QUEUE_POLICY);
  });

  it('defaults to the PRD 8 behaviour, not to permissive values', () => {
    expect(DEFAULT_QUEUE_POLICY.checkInRequired).toBe(true); // PRD 8.2
    expect(DEFAULT_QUEUE_POLICY.cutoffOnEtaOverrun).toBe(true); // PRD 8.12
    expect(DEFAULT_QUEUE_POLICY.requeueBehavior).toBe('END_OF_QUEUE'); // PRD 8.8
  });

  it('treats the three registration limits as independent', () => {
    // PRD 8.12 words them additively. Setting a token cap must not disable the
    // ETA guard - that is the regression this test exists to catch.
    const parsed = QueuePolicyFields.parse({ maxOnlineTokens: 40 });
    expect(parsed.maxOnlineTokens).toBe(40);
    expect(parsed.cutoffOnEtaOverrun).toBe(true);
    expect(parsed.cutoffMinsBeforeEnd).toBeNull();
  });

  it('rejects out-of-range thresholds', () => {
    expect(QueuePolicyFields.safeParse({ gracePeriodSec: -1 }).success).toBe(false);
    expect(QueuePolicyFields.safeParse({ maxOnlineTokens: 0 }).success).toBe(false);
    expect(QueuePolicyFields.safeParse({ recallAttempts: 99 }).success).toBe(false);
  });

  it('parses a cancellationRules row that predates a later field', () => {
    // Forward compatibility is the whole reason every field defaults: a row stored
    // today must still parse after Phase 5 adds a key, not crash on read.
    expect(CancellationRules.parse({})).toEqual({
      freeCancellationMins: 120,
      lateCancellationRefundPct: 50,
      noShowRefundPct: 0,
      sessionCancelledRefundPct: 100,
    });
    expect(CancellationRules.parse({ noShowRefundPct: 25 }).noShowRefundPct).toBe(25);
  });
});

describe('doctor schedule', () => {
  const base = { doctorId: '2a1f6f4c-0000-4000-8000-000000000000', startTime: '10:00', endTime: '13:00', defaultFeePaise: 50_000 };

  it('requires exactly one recurrence', () => {
    expect(CreateDoctorScheduleRequest.safeParse({ ...base, weekday: 1 }).success).toBe(true);
    expect(CreateDoctorScheduleRequest.safeParse({ ...base, date: '2026-09-01' }).success).toBe(true);
    expect(CreateDoctorScheduleRequest.safeParse(base).success).toBe(false);
    expect(
      CreateDoctorScheduleRequest.safeParse({ ...base, weekday: 1, date: '2026-09-01' }).success,
    ).toBe(false);
  });

  it('rejects a block that ends before it starts', () => {
    expect(
      CreateDoctorScheduleRequest.safeParse({ ...base, weekday: 1, startTime: '13:00', endTime: '10:00' }).success,
    ).toBe(false);
  });

  it('requires zero-padded 24-hour times', () => {
    // Padding is not cosmetic: it is what makes string comparison equal
    // chronological comparison, in Zod and in the database CHECK.
    expect(ClockTime.safeParse('09:00').success).toBe(true);
    expect(ClockTime.safeParse('9:00').success).toBe(false);
    expect(ClockTime.safeParse('24:00').success).toBe(false);
    expect(ClockTime.safeParse('10:60').success).toBe(false);
  });
});

describe('session + staff config', () => {
  const session = {
    doctorId: '2a1f6f4c-0000-4000-8000-000000000000',
    date: '2026-09-01',
    startTime: '10:00',
    endTime: '13:00',
    feePaise: 50_000,
  };

  it('defaults the token prefix and takes no status', () => {
    const parsed = CreateOPDSessionRequest.parse(session);
    expect(parsed.tokenPrefix).toBe('A');
    expect('status' in parsed).toBe(false);
  });

  it('rejects a fee that is not whole paise', () => {
    expect(CreateOPDSessionRequest.safeParse({ ...session, feePaise: 500.5 }).success).toBe(false);
  });

  it('requires a doctorId only when inviting a DOCTOR', () => {
    expect(InviteStaffRequest.safeParse({ email: 'a@b.com', role: 'RECEPTION' }).success).toBe(true);
    expect(InviteStaffRequest.safeParse({ email: 'a@b.com', role: 'DOCTOR' }).success).toBe(false);
    expect(
      InviteStaffRequest.safeParse({
        email: 'a@b.com',
        role: 'DOCTOR',
        doctorId: '2a1f6f4c-0000-4000-8000-000000000000',
      }).success,
    ).toBe(true);
  });
});

describe('pagination', () => {
  it('coerces query strings and applies defaults', () => {
    expect(PageQuery.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(PageQuery.parse({ limit: '50', offset: '100' })).toEqual({ limit: 50, offset: 100 });
  });

  it('caps the page size', () => {
    expect(PageQuery.safeParse({ limit: '1000' }).success).toBe(false);
  });
});

describe('config list queries', () => {
  it('paginates the session list (docs/Rules.md 6 - sessions accumulate daily)', () => {
    expect(SessionListQuery.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(SessionListQuery.parse({ limit: '5', date: '2026-08-30' })).toEqual({
      limit: 5,
      offset: 0,
      date: '2026-08-30',
    });
    expect(SessionListQuery.safeParse({ limit: '1000' }).success).toBe(false);
  });

  it('reads includeInactive=false as false, which z.coerce.boolean() would not', () => {
    expect(ConfigListQuery.parse({}).includeInactive).toBe(false);
    expect(ConfigListQuery.parse({ includeInactive: 'false' }).includeInactive).toBe(false);
    expect(ConfigListQuery.parse({ includeInactive: 'true' }).includeInactive).toBe(true);
    expect(ConfigListQuery.safeParse({ includeInactive: 'yes' }).success).toBe(false);
  });

  it('lets an update reactivate a deactivated doctor', () => {
    expect(UpdateDoctorRequest.parse({ isActive: true })).toEqual({ isActive: true });
    expect(UpdateDoctorRequest.parse({})).toEqual({});
  });
});

describe('discovery schemas', () => {
  const snapshot = {
    nowServingToken: null,
    checkedInCount: 0,
    bookedNotArrivedCount: 0,
    registrationOpen: true,
    joinNowEtaFrom: null,
    joinNowEtaTo: null,
  };

  const card = {
    id: '11111111-0000-4000-8000-000000000001',
    hospitalId: '11111111-0000-4000-8000-000000000002',
    hospitalName: 'Apollo Clinic',
    departmentId: '11111111-0000-4000-8000-000000000003',
    departmentName: 'Cardiology',
    doctorId: '11111111-0000-4000-8000-000000000004',
    doctorName: 'Dr. Anita Sharma',
    doctorSpecialization: null,
    isSubstitute: false,
    date: '2026-08-30',
    scheduledStart: '2026-08-30T04:30:00.000Z',
    scheduledEnd: '2026-08-30T07:30:00.000Z',
    status: 'OPEN_FOR_REGISTRATION',
    doctorPresence: 'NOT_PRESENT',
    feePaise: 50_000,
    snapshot,
  };

  it('accepts a card whose ETA window is still unfilled (Phase 7 fills it)', () => {
    expect(SessionCard.parse(card).snapshot.joinNowEtaFrom).toBeNull();
  });

  it('accepts the same card once Phase 7 fills the window - the shape does not change', () => {
    const filled = {
      ...card,
      snapshot: {
        ...snapshot,
        nowServingToken: 'A018',
        checkedInCount: 3,
        bookedNotArrivedCount: 5,
        joinNowEtaFrom: '2026-08-30T05:40:00.000Z',
        joinNowEtaTo: '2026-08-30T06:00:00.000Z',
      },
    };
    expect(SessionCard.parse(filled).snapshot.nowServingToken).toBe('A018');
  });

  it('keeps the two counts separate - they are not one number (docs/PRD.md 7.3)', () => {
    expect(Object.keys(QueueSnapshot.shape)).toContain('checkedInCount');
    expect(Object.keys(QueueSnapshot.shape)).toContain('bookedNotArrivedCount');
  });

  it('paginates every discovery list (docs/Rules.md 6)', () => {
    expect(HospitalSearchQuery.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(SessionCardQuery.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(DoctorSearchQuery.parse({})).toEqual({ limit: 20, offset: 0 });
    expect(HospitalSearchQuery.safeParse({ limit: '1000' }).success).toBe(false);
  });

  it('requires a hospitalId on the department list, since the path carries none', () => {
    expect(DepartmentListQuery.safeParse({}).success).toBe(false);
    expect(
      DepartmentListQuery.parse({ hospitalId: '11111111-0000-4000-8000-000000000002' }).limit,
    ).toBe(20);
  });

  it('trims search text and rejects an empty or oversized q', () => {
    expect(HospitalSearchQuery.parse({ q: '  apollo ' }).q).toBe('apollo');
    expect(HospitalSearchQuery.safeParse({ q: '   ' }).success).toBe(false);
    expect(HospitalSearchQuery.safeParse({ q: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('realtime + eta (P7-CONTRACT-01)', () => {
  const sessionId = '11111111-0000-4000-8000-000000000003';
  const accountId = '11111111-0000-4000-8000-000000000004';

  it('namespaces the two rooms so one can never be mistaken for the other', () => {
    expect(sessionRoom(sessionId)).toBe(`session:${sessionId}`);
    expect(accountRoom(accountId)).toBe(`account:${accountId}`);
    expect(sessionRoom(sessionId)).not.toBe(accountRoom(sessionId));
  });

  it('makes the session broadcast a doorbell, not a copy of the queue', () => {
    // Everyone looking at this doctor receives it. Carrying queue state here would
    // be a second definition of the live queue - one that could disagree with the
    // REST read - and one refactor away from carrying somebody's name with it.
    expect(Object.keys(SessionUpdatedEvent.shape)).toEqual(['sessionId', 'version']);
    expect(SessionUpdatedEvent.parse({ sessionId, version: 7 })).toEqual({ sessionId, version: 7 });
  });

  it('strips anything a caller tries to smuggle into the broadcast', () => {
    const parsed = SessionUpdatedEvent.parse({
      sessionId,
      version: 7,
      patientName: 'Anita Sharma',
    }) as Record<string, unknown>;
    expect(parsed.patientName).toBeUndefined();
  });

  it('makes the personal event a nudge, not a copy of the state', () => {
    // No status, no ETA: the client refetches, so there is exactly one path by which
    // a patient's screen learns what is true.
    expect(Object.keys(EntryUpdatedEvent.shape)).toEqual(['entryId', 'sessionId', 'version']);
  });

  it('only lets a client ask for a session room, and only by uuid', () => {
    expect(SubscribeRequest.safeParse({ sessionId }).success).toBe(true);
    expect(SubscribeRequest.safeParse({ sessionId: 'session:*' }).success).toBe(false);
    expect(SubscribeRequest.safeParse({ accountId }).success).toBe(false);
  });

  it('says what the estimate stands on, so a doctor can judge whether to trust it', () => {
    expect(EtaBasis.options).toEqual(['SEED', 'DOCTOR_HISTORY', 'TODAY']);
    const eta = SessionEta.parse({
      sessionId,
      expectedConsultMins: 12.5,
      basis: 'SEED',
      sampleSize: 0,
      runningBehind: false,
      deadTimeMins: 2,
      deadTimeBasis: 'SEED',
      deadTimeSamples: 0,
      joinNowEtaFrom: null,
      joinNowEtaTo: null,
    });
    expect(eta.sampleSize).toBe(0);
    // A zero or negative estimate is never a valid answer - it would produce a
    // window that has already passed.
    expect(SessionEta.safeParse({ ...eta, expectedConsultMins: 0 }).success).toBe(false);
  });

  it('reports handover time separately from consultation time', () => {
    // Two bases, not three: turnaround belongs to the room and the day rather than
    // to the doctor, so a doctor's history from last month says nothing useful about
    // this morning. Either this session has shown its own handovers or it has not.
    expect(DeadTimeBasis.options).toEqual(['SEED', 'MEASURED']);

    const base = {
      sessionId,
      expectedConsultMins: 12.5,
      basis: 'SEED' as const,
      sampleSize: 0,
      runningBehind: false,
      deadTimeBasis: 'SEED' as const,
      deadTimeSamples: 1,
      joinNowEtaFrom: null,
      joinNowEtaTo: null,
    };

    // Zero IS a valid handover time - a clinic where the next patient is already at
    // the door - unlike expectedConsultMins, where zero would be nonsense.
    expect(SessionEta.safeParse({ ...base, deadTimeMins: 0 }).success).toBe(true);
    expect(SessionEta.safeParse({ ...base, deadTimeMins: -1 }).success).toBe(false);

    // Samples counts what was SEEN, so it may exceed zero while the basis is still
    // SEED: one handover is an anecdote, and the schema must not forbid saying so.
    expect(SessionEta.parse({ ...base, deadTimeMins: 2 }).deadTimeSamples).toBe(1);
  });
});
