/**
 * Development seed: enough realistic configuration that Phase 3 discovery has
 * something to browse.
 *
 * Two guards, both required by docs/Phases.md:
 *   1. It refuses to run when NODE_ENV is production.
 *   2. It refuses to run if the database holds a hospital this script did not
 *      create, so it can never be pointed at a real tenant's data.
 *
 * Idempotent: every row has a fixed id and is upserted, and sessions are inserted
 * with `skipDuplicates`, so running it repeatedly converges instead of multiplying.
 *
 * ponytail: lives in src/ (not the conventional prisma/seed.ts) so `nest build`
 * compiles it and no TypeScript-runner dependency is needed just to run one script.
 * Move it back and add tsx if a second standalone script ever appears.
 */
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { DEFAULT_QUEUE_POLICY } from '@opd/contracts';
import { dateColumnFromString, istToUtc, istToday, istWeekday } from './common/ist';

const prisma = new PrismaClient();

/** Fixed ids: what makes the seed idempotent AND recognisable as seeded data. */
const HOSPITALS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'Apollo Clinic', city: 'Mumbai', area: 'Andheri West' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', name: 'Fortis Health Point', city: 'Bengaluru', area: 'Indiranagar' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', name: 'Max Care Centre', city: 'New Delhi', area: 'Saket' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000004', name: "Rainbow Children's Clinic", city: 'Hyderabad', area: 'Banjara Hills' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000005', name: 'Sahyadri Speciality', city: 'Pune', area: 'Kothrud' },
  { id: 'aaaaaaaa-0000-4000-8000-000000000006', name: 'Kauvery Clinic', city: 'Chennai', area: 'T. Nagar' },
] as const;

const DEPARTMENTS = [
  { id: 'bbbbbbbb-0000-4000-8000-000000000001', hospitalId: HOSPITALS[0].id, name: 'Cardiology' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000002', hospitalId: HOSPITALS[0].id, name: 'Orthopaedics' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000003', hospitalId: HOSPITALS[0].id, name: 'General Medicine' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000004', hospitalId: HOSPITALS[1].id, name: 'Cardiology' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000005', hospitalId: HOSPITALS[1].id, name: 'Paediatrics' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000006', hospitalId: HOSPITALS[2].id, name: 'General Medicine' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000007', hospitalId: HOSPITALS[2].id, name: 'Dermatology' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000008', hospitalId: HOSPITALS[2].id, name: 'ENT' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000009', hospitalId: HOSPITALS[3].id, name: 'Paediatrics' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000010', hospitalId: HOSPITALS[3].id, name: 'Gynaecology' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000011', hospitalId: HOSPITALS[4].id, name: 'Orthopaedics' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000012', hospitalId: HOSPITALS[4].id, name: 'General Medicine' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000013', hospitalId: HOSPITALS[5].id, name: 'Cardiology' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000014', hospitalId: HOSPITALS[5].id, name: 'Diabetology' },
] as const;

const DOCTORS = [
  { id: 'cccccccc-0000-4000-8000-000000000001', departmentId: DEPARTMENTS[0].id, name: 'Dr. Anita Sharma', specialization: 'Interventional Cardiology', defaultConsultMins: 12 },
  { id: 'cccccccc-0000-4000-8000-000000000002', departmentId: DEPARTMENTS[0].id, name: 'Dr. Rohit Menon', specialization: 'Cardiology', defaultConsultMins: 10 },
  { id: 'cccccccc-0000-4000-8000-000000000003', departmentId: DEPARTMENTS[1].id, name: 'Dr. Kavita Rao', specialization: 'Joint Replacement', defaultConsultMins: 15 },
  { id: 'cccccccc-0000-4000-8000-000000000004', departmentId: DEPARTMENTS[2].id, name: 'Dr. Suresh Iyer', specialization: null, defaultConsultMins: 8 },
  { id: 'cccccccc-0000-4000-8000-000000000005', departmentId: DEPARTMENTS[3].id, name: 'Dr. Neha Gupta', specialization: 'Cardiology', defaultConsultMins: 12 },
  { id: 'cccccccc-0000-4000-8000-000000000006', departmentId: DEPARTMENTS[4].id, name: 'Dr. Arjun Nair', specialization: 'Neonatology', defaultConsultMins: 14 },
  { id: 'cccccccc-0000-4000-8000-000000000007', departmentId: DEPARTMENTS[5].id, name: 'Dr. Vikram Malhotra', specialization: null, defaultConsultMins: 9 },
  { id: 'cccccccc-0000-4000-8000-000000000008', departmentId: DEPARTMENTS[5].id, name: 'Dr. Priya Chandra', specialization: 'Internal Medicine', defaultConsultMins: 11 },
  { id: 'cccccccc-0000-4000-8000-000000000009', departmentId: DEPARTMENTS[6].id, name: 'Dr. Sneha Kulkarni', specialization: 'Cosmetic Dermatology', defaultConsultMins: 13 },
  { id: 'cccccccc-0000-4000-8000-000000000010', departmentId: DEPARTMENTS[7].id, name: 'Dr. Imran Qureshi', specialization: 'Head & Neck Surgery', defaultConsultMins: 16 },
  { id: 'cccccccc-0000-4000-8000-000000000011', departmentId: DEPARTMENTS[8].id, name: 'Dr. Lakshmi Venkatesan', specialization: 'Paediatric Pulmonology', defaultConsultMins: 12 },
  { id: 'cccccccc-0000-4000-8000-000000000012', departmentId: DEPARTMENTS[8].id, name: 'Dr. Farhan Ali', specialization: null, defaultConsultMins: 10 },
  { id: 'cccccccc-0000-4000-8000-000000000013', departmentId: DEPARTMENTS[9].id, name: 'Dr. Meera Joshi', specialization: 'High-Risk Obstetrics', defaultConsultMins: 18 },
  { id: 'cccccccc-0000-4000-8000-000000000014', departmentId: DEPARTMENTS[10].id, name: 'Dr. Sandeep Deshmukh', specialization: 'Sports Injury', defaultConsultMins: 14 },
  { id: 'cccccccc-0000-4000-8000-000000000015', departmentId: DEPARTMENTS[11].id, name: 'Dr. Ritu Bansal', specialization: null, defaultConsultMins: 8 },
  { id: 'cccccccc-0000-4000-8000-000000000016', departmentId: DEPARTMENTS[12].id, name: 'Dr. Ganesh Subramanian', specialization: 'Electrophysiology', defaultConsultMins: 15 },
  { id: 'cccccccc-0000-4000-8000-000000000017', departmentId: DEPARTMENTS[13].id, name: 'Dr. Aisha Thomas', specialization: 'Endocrinology', defaultConsultMins: 12 },
] as const;

/** Every doctor works every day, so a freshly seeded database always has sessions today. */
const SCHEDULES = DOCTORS.flatMap((doctor, index) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: `dddddddd-${String(index).padStart(4, '0')}-4000-8000-${String(weekday).padStart(12, '0')}`,
    doctorId: doctor.id,
    weekday,
    startTime: index % 2 === 0 ? '10:00' : '15:00',
    endTime: index % 2 === 0 ? '13:00' : '18:00',
    defaultFeePaise: 40_000 + index * 10_000,
  })),
);

const DEMO_PASSWORD = 'Demo@12345';
const STAFF = [
  { id: 'eeeeeeee-0000-4000-8000-000000000001', email: 'admin@apollo.test', hospitalId: HOSPITALS[0].id, role: 'ADMIN' as const },
  { id: 'eeeeeeee-0000-4000-8000-000000000002', email: 'reception@apollo.test', hospitalId: HOSPITALS[0].id, role: 'RECEPTION' as const },
  { id: 'eeeeeeee-0000-4000-8000-000000000003', email: 'admin@fortis.test', hospitalId: HOSPITALS[1].id, role: 'ADMIN' as const },
  // Phase 6: the doctor console resolves the signed-in account to a Doctor row, so
  // without a DOCTOR membership LINKED to one there was no way to open it at all.
  // Linked to Dr. Anita Sharma, who runs the 10:00 Apollo cardiology session.
  { id: 'eeeeeeee-0000-4000-8000-000000000004', email: 'doctor@apollo.test', hospitalId: HOSPITALS[0].id, role: 'DOCTOR' as const, doctorId: DOCTORS[0].id },
  // A second hospital with a working reception console, so tenant scoping can be
  // seen rather than only asserted: this login must not be able to reach Apollo.
  { id: 'eeeeeeee-0000-4000-8000-000000000005', email: 'reception@max.test', hospitalId: HOSPITALS[2].id, role: 'RECEPTION' as const },
];

/**
 * A patient account, with a family.
 *
 * Previously the only way to get one was to sign up through the app, so a rebuilt
 * database left the phone with nothing to log into - and every test of the patient
 * flow started with a registration detour. An account holds several profiles
 * (docs/PRD.md 6.2), and having three of them is what makes "For <name>" on a
 * booking mean anything: with one profile you cannot tell whether the app is
 * showing the right person.
 */
const PATIENT_ACCOUNT = { email: 'testpatient@apollo.test' } as const;
const PATIENT_PROFILES = [
  { id: '88888888-0000-4000-8000-000000000001', name: 'Test Patient', relation: 'SELF' as const, gender: 'MALE' as const },
  { id: '88888888-0000-4000-8000-000000000002', name: 'Asha Semwal', relation: 'MOTHER' as const, gender: 'FEMALE' as const },
  { id: '88888888-0000-4000-8000-000000000003', name: 'Rohan Semwal', relation: 'CHILD' as const, gender: 'MALE' as const },
] as const;

/**
 * People already in the queue.
 *
 * An empty session is the one state that cannot be tested: "you are 4th, about
 * 35 minutes" needs three people ahead of you, a doctor console needs somebody to
 * call, and the ETA engine cannot blend a history that does not exist. So each
 * live session is seeded mid-clinic - two consultations done, one in progress, a
 * couple waiting, and one no-show.
 *
 * Written as rows rather than through the queue commands on purpose. The commands
 * are the only legal path AT RUNTIME (docs/Rules.md 2); a fixture that replayed
 * them would have to fake a caller, a clock and a lock to land on the same state,
 * and would still not be the thing under test. What must stay true is the SHAPE:
 * every timestamp below is consistent with the status it belongs to, because a
 * COMPLETED entry with no completedAt would make the console lie.
 *
 * `minsAgo` is minutes before now, so a re-seed always lands a fresh clinic
 * around the current time instead of a stale one from whenever it last ran.
 */
const WALK_IN_NAMES = [
  'Ramesh Gupta',
  'Sunita Patil',
  'Imtiaz Khan',
  'Deepa Nair',
  'Harpreet Singh',
  'Lata Mishra',
] as const;

const WALK_IN_PLAN = [
  { status: 'COMPLETED' as const, joined: 74, checkedIn: 72, called: 64, started: 63, completed: 51 },
  { status: 'COMPLETED' as const, joined: 69, checkedIn: 67, called: 50, started: 49, completed: 38 },
  { status: 'IN_CONSULTATION' as const, joined: 64, checkedIn: 60, called: 9, started: 7 },
  { status: 'CHECKED_IN' as const, joined: 58, checkedIn: 34 },
  { status: 'CHECKED_IN' as const, joined: 52, checkedIn: 21 },
  // Called twice and never appeared. recallCount is what the no-show rule counts.
  { status: 'NO_SHOW' as const, joined: 46, checkedIn: 40, called: 18, recallCount: 2 },
] as const;

/**
 * The patient account's own bookings - one per hospital, rotating through the
 * three profiles, so My Visits has a live booking, an arrival, a past visit and a
 * cancellation to show, and "For <name>" has more than one name to get right.
 */
const ONLINE_PLAN = [
  { status: 'CONFIRMED' as const, profile: 0, joined: 30 },
  { status: 'CHECKED_IN' as const, profile: 1, joined: 44, checkedIn: 12 },
  { status: 'CONFIRMED' as const, profile: 2, joined: 26 },
  { status: 'COMPLETED' as const, profile: 0, joined: 82, checkedIn: 77, called: 31, started: 30, completed: 20 },
  { status: 'CONFIRMED' as const, profile: 1, joined: 18 },
  { status: 'CANCELLED' as const, profile: 2, joined: 90 },
] as const;

async function assertSafeToSeed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to seed: NODE_ENV is production');
  }

  const seededIds: string[] = HOSPITALS.map((h) => h.id);
  const foreign = await prisma.hospital.count({ where: { id: { notIn: seededIds } } });
  if (foreign > 0) {
    throw new Error(
      `refusing to seed: the database holds ${foreign} hospital(s) this script did not create. ` +
        'That looks like real data.',
    );
  }
}

async function main(): Promise<void> {
  await assertSafeToSeed();

  for (const hospital of HOSPITALS) {
    await prisma.hospital.upsert({
      where: { id: hospital.id },
      update: { name: hospital.name, city: hospital.city, area: hospital.area },
      create: { ...hospital, status: 'VERIFIED' },
    });

    // The engine must never meet a hospital without a policy, and the defaults live
    // once - in contracts, not repeated here.
    await prisma.queuePolicy.upsert({
      where: { hospitalId: hospital.id },
      update: {},
      create: { hospitalId: hospital.id, ...DEFAULT_QUEUE_POLICY },
    });
  }

  for (const department of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { id: department.id },
      update: { name: department.name },
      create: department,
    });
  }

  const departmentHospital = new Map(DEPARTMENTS.map((d) => [d.id, d.hospitalId] as const));
  for (const doctor of DOCTORS) {
    const hospitalId = departmentHospital.get(doctor.departmentId)!;
    await prisma.doctor.upsert({
      where: { id: doctor.id },
      update: { name: doctor.name, specialization: doctor.specialization },
      create: { ...doctor, hospitalId },
    });
  }

  const doctorHospital = new Map(
    DOCTORS.map((d) => [d.id, departmentHospital.get(d.departmentId)!] as const),
  );
  for (const schedule of SCHEDULES) {
    await prisma.doctorSchedule.upsert({
      where: { id: schedule.id },
      update: { startTime: schedule.startTime, endTime: schedule.endTime },
      create: { ...schedule, hospitalId: doctorHospital.get(schedule.doctorId)! },
    });
  }

  const passwordHash = await argonHash(DEMO_PASSWORD);
  for (const member of STAFF) {
    const account = await prisma.account.upsert({
      where: { email: member.email },
      update: { passwordHash },
      create: { email: member.email, passwordHash },
    });
    await prisma.hospitalStaff.upsert({
      where: { hospitalId_accountId: { hospitalId: member.hospitalId, accountId: account.id } },
      update: { role: member.role, status: 'ACTIVE' },
      create: {
        id: member.id,
        hospitalId: member.hospitalId,
        accountId: account.id,
        role: member.role,
        status: 'ACTIVE',
      },
    });

    // The membership says "this account is a doctor here"; `Doctor.accountId` says
    // WHICH doctor. Both are needed - the first authorises, the second is how the
    // console knows whose sessions to show.
    if (member.doctorId !== undefined) {
      await prisma.doctor.update({
        where: { id: member.doctorId },
        data: { accountId: account.id },
      });
    }
  }

  const patientAccount = await prisma.account.upsert({
    where: { email: PATIENT_ACCOUNT.email },
    update: { passwordHash },
    create: { email: PATIENT_ACCOUNT.email, passwordHash },
  });
  for (const profile of PATIENT_PROFILES) {
    await prisma.patient.upsert({
      where: { id: profile.id },
      update: { name: profile.name, relation: profile.relation, gender: profile.gender },
      create: { ...profile, accountId: patientAccount.id },
    });
  }

  // Today's sessions. The date is IST and computed here, not by the caller - the
  // 00:30 IST run must produce today's sessions, not yesterday's.
  const date = istToday();
  const weekday = istWeekday(date);
  const todays = SCHEDULES.filter((s) => s.weekday === weekday);

  const { count } = await prisma.oPDSession.createMany({
    data: todays.map((schedule) => ({
      hospitalId: doctorHospital.get(schedule.doctorId)!,
      departmentId: DOCTORS.find((d) => d.id === schedule.doctorId)!.departmentId,
      scheduleId: schedule.id,
      originalDoctorId: schedule.doctorId,
      currentProviderDoctorId: schedule.doctorId,
      date: dateColumnFromString(date),
      scheduledStart: istToUtc(date, schedule.startTime),
      scheduledEnd: istToUtc(date, schedule.endTime),
      feePaise: schedule.defaultFeePaise,
    })),
    // Idempotency comes from unique(originalDoctorId, date, scheduledStart) - the
    // same database constraint the generate endpoint relies on.
    skipDuplicates: true,
  });

  // One clinic per hospital that is RUNNING RIGHT NOW.
  //
  // The recurring schedules above are realistic (10:00-13:00, 15:00-18:00 IST) and
  // therefore closed most of the time someone sits down to look at the app. Without
  // this, every session card in discovery reads "Registration closed" - correct, but
  // it makes the open state impossible to see or demo.
  //
  // Upserted by a fixed id so re-seeding MOVES the window instead of accumulating a
  // new session every run. The 30-second offset is what keeps it from ever colliding
  // with unique(originalDoctorId, date, scheduledStart): a generated session always
  // starts on an exact minute, because it is built from an "HH:mm" clock face.
  const liveStart = new Date(Date.now() - 60 * 60 * 1000);
  liveStart.setSeconds(30, 0);
  const liveEnd = new Date(liveStart.getTime() + 4 * 60 * 60 * 1000);

  for (const [index, hospital] of HOSPITALS.entries()) {
    const doctor = DOCTORS.find((d) => departmentHospital.get(d.departmentId) === hospital.id)!;
    const columns = {
      hospitalId: hospital.id,
      departmentId: doctor.departmentId,
      originalDoctorId: doctor.id,
      currentProviderDoctorId: doctor.id,
      date: dateColumnFromString(date),
      scheduledStart: liveStart,
      scheduledEnd: liveEnd,
      feePaise: 60_000,
      tokenPrefix: 'B',
    };
    // ACTIVE with the doctor PRESENT, because the queue below has somebody
    // IN_CONSULTATION - and since the ON_BREAK fix, calling and starting are
    // refused unless the doctor is present. A seeded state that the engine would
    // reject is a fixture that teaches the wrong thing.
    const live = { ...columns, status: 'ACTIVE' as const, doctorPresence: 'PRESENT' as const };
    await prisma.oPDSession.upsert({
      where: { id: `ffffffff-0000-4000-8000-${String(index).padStart(12, '0')}` },
      update: {
        scheduledStart: liveStart,
        scheduledEnd: liveEnd,
        date: columns.date,
        status: 'ACTIVE',
        doctorPresence: 'PRESENT',
      },
      create: { id: `ffffffff-0000-4000-8000-${String(index).padStart(12, '0')}`, ...live },
    });
  }

  // --- fill those live sessions with a clinic already in progress ------------
  const minsAgo = (mins: number): Date => new Date(Date.now() - mins * 60_000);
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  let entryCount = 0;

  for (const [index, hospital] of HOSPITALS.entries()) {
    const sessionId = `ffffffff-0000-4000-8000-${pad(index, 12)}`;

    for (const [seat, plan] of WALK_IN_PLAN.entries()) {
      // A walk-in has no app account: reception registered them at the desk, so
      // `accountId` stays null and there is no Payment row (they paid there).
      const patientId = `77777777-${pad(index, 4)}-4000-8000-${pad(seat, 12)}`;
      const patientName = WALK_IN_NAMES[seat]!;
      await prisma.patient.upsert({
        where: { id: patientId },
        update: { name: patientName },
        create: { id: patientId, name: patientName, relation: 'SELF' },
      });

      const tokenNumber = seat + 1;
      await prisma.queueEntry.upsert({
        where: { id: `76767676-${pad(index, 4)}-4000-8000-${pad(tokenNumber, 12)}` },
        update: { status: plan.status },
        create: {
          id: `76767676-${pad(index, 4)}-4000-8000-${pad(tokenNumber, 12)}`,
          hospitalId: hospital.id,
          sessionId,
          patientId,
          tokenNumber,
          tokenLabel: `B${pad(tokenNumber, 3)}`,
          type: 'WALK_IN',
          status: plan.status,
          recallCount: 'recallCount' in plan ? plan.recallCount : 0,
          joinedAt: minsAgo(plan.joined),
          checkedInAt: 'checkedIn' in plan ? minsAgo(plan.checkedIn) : null,
          calledAt: 'called' in plan ? minsAgo(plan.called) : null,
          consultStartedAt: 'started' in plan ? minsAgo(plan.started) : null,
          completedAt: 'completed' in plan ? minsAgo(plan.completed) : null,
        },
      });
      entryCount += 1;
    }

    // One online booking per hospital, belonging to the patient account.
    const online = ONLINE_PLAN[index % ONLINE_PLAN.length]!;
    const tokenNumber = WALK_IN_PLAN.length + 1;
    const entryId = `76767676-${pad(index, 4)}-4000-8000-${pad(tokenNumber, 12)}`;
    await prisma.queueEntry.upsert({
      where: { id: entryId },
      update: { status: online.status },
      create: {
        id: entryId,
        hospitalId: hospital.id,
        sessionId,
        patientId: PATIENT_PROFILES[online.profile].id,
        accountId: patientAccount.id,
        tokenNumber,
        tokenLabel: `B${pad(tokenNumber, 3)}`,
        type: 'ONLINE',
        status: online.status,
        joinedAt: minsAgo(online.joined),
        checkedInAt: 'checkedIn' in online ? minsAgo(online.checkedIn) : null,
        calledAt: 'called' in online ? minsAgo(online.called) : null,
        consultStartedAt: 'started' in online ? minsAgo(online.started) : null,
        completedAt: 'completed' in online ? minsAgo(online.completed) : null,
      },
    });
    entryCount += 1;

    // Money follows the booking: an online seat exists because it was paid for.
    // The cancelled one is REFUNDED rather than deleted - a refund is a new fact,
    // not the erasure of an old one (docs/Rules.md 5).
    await prisma.payment.upsert({
      where: { queueEntryId: entryId },
      update: {},
      create: {
        id: `66666666-0000-4000-8000-${pad(index, 12)}`,
        hospitalId: hospital.id,
        queueEntryId: entryId,
        accountId: patientAccount.id,
        amountPaise: 60_000,
        status: online.status === 'CANCELLED' ? 'REFUNDED' : 'SUCCESS',
        refundedPaise: online.status === 'CANCELLED' ? 60_000 : 0,
        razorpayOrderId: `order_seed_${pad(index, 4)}`,
        razorpayPaymentId: `pay_seed_${pad(index, 4)}`,
      },
    });
  }

  console.log(
    [
      `seeded ${HOSPITALS.length} hospitals, ${DEPARTMENTS.length} departments, ` +
        `${DOCTORS.length} doctors, ${SCHEDULES.length} schedules`,
      `sessions for ${date} (IST): ${count} created, ${todays.length - count} already present`,
      `plus ${HOSPITALS.length} live-now session(s) so discovery has an OPEN card to show`,
      `${entryCount} queue entries across them: ${WALK_IN_PLAN.length} walk-ins + 1 online booking each`,
      `cities: ${[...new Set(HOSPITALS.map((h) => h.city))].join(', ')}`,
      `staff logins: ${STAFF.map((s) => s.email).join(', ')} / ${DEMO_PASSWORD}`,
      `patient login: ${PATIENT_ACCOUNT.email} / ${DEMO_PASSWORD} ` +
        `(${PATIENT_PROFILES.length} profiles: ${PATIENT_PROFILES.map((p) => p.name).join(', ')})`,
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
