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
] as const;

const DEPARTMENTS = [
  { id: 'bbbbbbbb-0000-4000-8000-000000000001', hospitalId: HOSPITALS[0].id, name: 'Cardiology' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000002', hospitalId: HOSPITALS[0].id, name: 'Orthopaedics' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000003', hospitalId: HOSPITALS[0].id, name: 'General Medicine' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000004', hospitalId: HOSPITALS[1].id, name: 'Cardiology' },
  { id: 'bbbbbbbb-0000-4000-8000-000000000005', hospitalId: HOSPITALS[1].id, name: 'Paediatrics' },
] as const;

const DOCTORS = [
  { id: 'cccccccc-0000-4000-8000-000000000001', departmentId: DEPARTMENTS[0].id, name: 'Dr. Anita Sharma', specialization: 'Interventional Cardiology', defaultConsultMins: 12 },
  { id: 'cccccccc-0000-4000-8000-000000000002', departmentId: DEPARTMENTS[0].id, name: 'Dr. Rohit Menon', specialization: 'Cardiology', defaultConsultMins: 10 },
  { id: 'cccccccc-0000-4000-8000-000000000003', departmentId: DEPARTMENTS[1].id, name: 'Dr. Kavita Rao', specialization: 'Joint Replacement', defaultConsultMins: 15 },
  { id: 'cccccccc-0000-4000-8000-000000000004', departmentId: DEPARTMENTS[2].id, name: 'Dr. Suresh Iyer', specialization: null, defaultConsultMins: 8 },
  { id: 'cccccccc-0000-4000-8000-000000000005', departmentId: DEPARTMENTS[3].id, name: 'Dr. Neha Gupta', specialization: 'Cardiology', defaultConsultMins: 12 },
  { id: 'cccccccc-0000-4000-8000-000000000006', departmentId: DEPARTMENTS[4].id, name: 'Dr. Arjun Nair', specialization: 'Neonatology', defaultConsultMins: 14 },
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
];

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

  console.log(
    [
      `seeded ${HOSPITALS.length} hospitals, ${DEPARTMENTS.length} departments, ` +
        `${DOCTORS.length} doctors, ${SCHEDULES.length} schedules`,
      `sessions for ${date} (IST): ${count} created, ${todays.length - count} already present`,
      `logins: ${STAFF.map((s) => s.email).join(', ')} / ${DEMO_PASSWORD}`,
    ].join('\n'),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
