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
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { hash as argonHash } from "@node-rs/argon2";
import { DEFAULT_QUEUE_POLICY } from "@opd/contracts";
import {
  dateColumnFromString,
  istToUtc,
  istToday,
  istWeekday,
} from "./common/ist";

const prisma = new PrismaClient();

/**
 * Demo photography, from public CDNs and verified to resolve.
 *
 * Real URLs rather than placeholders on purpose: the whole path - the column, the
 * contract, the API mapper, expo-image's cache and the client fallback - is only
 * exercised end to end if something actually loads over the network. A hospital's own
 * photograph will come from an upload in the admin console later; `photoUrl` does not
 * change when it does.
 *
 * **One hospital and one doctor are deliberately left null.** Null is the ordinary
 * case at pilot - most clinics will never upload anything - and a fallback nobody
 * ever sees is a fallback nobody has checked.
 */
const unsplash = (id: string) =>
  `https://images.unsplash.com/${id}?w=900&q=80&auto=format&fit=crop`;
/** Stable portrait per index, spread across the set so no two neighbours match. */
const portrait = (index: number) =>
  `https://i.pravatar.cc/400?img=${((index * 7) % 70) + 1}`;

/** Fixed ids: what makes the seed idempotent AND recognisable as seeded data. */
const HOSPITALS = [
  {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    name: "Apollo Clinic",
    city: "Mumbai",
    area: "Andheri West",
    photoUrl: unsplash("photo-1519494026892-80bbd2d6fd0d"),
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000002",
    name: "Fortis Health Point",
    city: "Bengaluru",
    area: "Indiranagar",
    photoUrl: unsplash("photo-1586773860418-d37222d8fce3"),
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000003",
    name: "Max Care Centre",
    city: "New Delhi",
    area: "Saket",
    photoUrl: unsplash("photo-1504439468489-c8920d796a29"),
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000004",
    name: "Rainbow Children's Clinic",
    city: "Hyderabad",
    area: "Banjara Hills",
    photoUrl: unsplash("photo-1538108149393-fbbd81895907"),
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000005",
    name: "Sahyadri Speciality",
    city: "Pune",
    area: "Kothrud",
    photoUrl: unsplash("photo-1516549655169-df83a0774514"),
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000006",
    name: "Kauvery Clinic",
    city: "Chennai",
    area: "T. Nagar",
    photoUrl: unsplash("photo-1551190822-a9333d879b1f"),
  },
  // Mumbai deliberately has FOUR hospitals while every other city has one. Home is a
  // city-scoped list, so a city with a single row makes the list impossible to judge
  // - and a patient's real choice is between several nearby hospitals, not one.
  {
    id: "aaaaaaaa-0000-4000-8000-000000000007",
    name: "Lilavati Hospital",
    city: "Mumbai",
    area: "Bandra West",
    photoUrl: unsplash("photo-1629909613654-28e377c37b09"),
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000008",
    name: "Hinduja Healthcare",
    city: "Mumbai",
    area: "Khar West",
    photoUrl: null,
  },
  {
    id: "aaaaaaaa-0000-4000-8000-000000000009",
    name: "Nanavati Max",
    city: "Mumbai",
    area: "Vile Parle West",
    photoUrl: unsplash("photo-1516841273335-e39b37888115"),
  },
] as const;

const DEPARTMENTS = [
  {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    hospitalId: HOSPITALS[0].id,
    name: "Cardiology",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    hospitalId: HOSPITALS[0].id,
    name: "Orthopaedics",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000003",
    hospitalId: HOSPITALS[0].id,
    name: "General Medicine",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000004",
    hospitalId: HOSPITALS[1].id,
    name: "Cardiology",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000005",
    hospitalId: HOSPITALS[1].id,
    name: "Paediatrics",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000006",
    hospitalId: HOSPITALS[2].id,
    name: "General Medicine",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000007",
    hospitalId: HOSPITALS[2].id,
    name: "Dermatology",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000008",
    hospitalId: HOSPITALS[2].id,
    name: "ENT",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000009",
    hospitalId: HOSPITALS[3].id,
    name: "Paediatrics",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000010",
    hospitalId: HOSPITALS[3].id,
    name: "Gynaecology",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000011",
    hospitalId: HOSPITALS[4].id,
    name: "Orthopaedics",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000012",
    hospitalId: HOSPITALS[4].id,
    name: "General Medicine",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000013",
    hospitalId: HOSPITALS[5].id,
    name: "Cardiology",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000014",
    hospitalId: HOSPITALS[5].id,
    name: "Diabetology",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000015",
    hospitalId: HOSPITALS[6].id,
    name: "Cardiology",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000016",
    hospitalId: HOSPITALS[6].id,
    name: "Neurology",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000017",
    hospitalId: HOSPITALS[6].id,
    name: "General Medicine",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000018",
    hospitalId: HOSPITALS[7].id,
    name: "Orthopaedics",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000019",
    hospitalId: HOSPITALS[7].id,
    name: "Dermatology",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000020",
    hospitalId: HOSPITALS[8].id,
    name: "Paediatrics",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000021",
    hospitalId: HOSPITALS[8].id,
    name: "ENT",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000022",
    hospitalId: HOSPITALS[8].id,
    name: "General Medicine",
  },
] as const;

const DOCTORS = [
  {
    id: "cccccccc-0000-4000-8000-000000000001",
    departmentId: DEPARTMENTS[0].id,
    name: "Dr. Anita Sharma",
    specialization: "Interventional Cardiology",
    defaultConsultMins: 12,
    photoUrl: portrait(0),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000002",
    departmentId: DEPARTMENTS[0].id,
    name: "Dr. Rohit Menon",
    specialization: "Cardiology",
    defaultConsultMins: 10,
    photoUrl: portrait(1),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000003",
    departmentId: DEPARTMENTS[1].id,
    name: "Dr. Kavita Rao",
    specialization: "Joint Replacement",
    defaultConsultMins: 15,
    photoUrl: portrait(2),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000004",
    departmentId: DEPARTMENTS[2].id,
    name: "Dr. Suresh Iyer",
    specialization: null,
    defaultConsultMins: 8,
    photoUrl: null,
  },
  {
    id: "cccccccc-0000-4000-8000-000000000005",
    departmentId: DEPARTMENTS[3].id,
    name: "Dr. Neha Gupta",
    specialization: "Cardiology",
    defaultConsultMins: 12,
    photoUrl: portrait(4),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000006",
    departmentId: DEPARTMENTS[4].id,
    name: "Dr. Arjun Nair",
    specialization: "Neonatology",
    defaultConsultMins: 14,
    photoUrl: portrait(5),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000007",
    departmentId: DEPARTMENTS[5].id,
    name: "Dr. Vikram Malhotra",
    specialization: null,
    defaultConsultMins: 9,
    photoUrl: portrait(6),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000008",
    departmentId: DEPARTMENTS[5].id,
    name: "Dr. Priya Chandra",
    specialization: "Internal Medicine",
    defaultConsultMins: 11,
    photoUrl: portrait(7),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000009",
    departmentId: DEPARTMENTS[6].id,
    name: "Dr. Sneha Kulkarni",
    specialization: "Cosmetic Dermatology",
    defaultConsultMins: 13,
    photoUrl: portrait(8),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000010",
    departmentId: DEPARTMENTS[7].id,
    name: "Dr. Imran Qureshi",
    specialization: "Head & Neck Surgery",
    defaultConsultMins: 16,
    photoUrl: portrait(9),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000011",
    departmentId: DEPARTMENTS[8].id,
    name: "Dr. Lakshmi Venkatesan",
    specialization: "Paediatric Pulmonology",
    defaultConsultMins: 12,
    photoUrl: portrait(10),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000012",
    departmentId: DEPARTMENTS[8].id,
    name: "Dr. Farhan Ali",
    specialization: null,
    defaultConsultMins: 10,
    photoUrl: portrait(11),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000013",
    departmentId: DEPARTMENTS[9].id,
    name: "Dr. Meera Joshi",
    specialization: "High-Risk Obstetrics",
    defaultConsultMins: 18,
    photoUrl: portrait(12),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000014",
    departmentId: DEPARTMENTS[10].id,
    name: "Dr. Sandeep Deshmukh",
    specialization: "Sports Injury",
    defaultConsultMins: 14,
    photoUrl: portrait(13),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000015",
    departmentId: DEPARTMENTS[11].id,
    name: "Dr. Ritu Bansal",
    specialization: null,
    defaultConsultMins: 8,
    photoUrl: portrait(14),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000016",
    departmentId: DEPARTMENTS[12].id,
    name: "Dr. Ganesh Subramanian",
    specialization: "Electrophysiology",
    defaultConsultMins: 15,
    photoUrl: portrait(15),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000017",
    departmentId: DEPARTMENTS[13].id,
    name: "Dr. Aisha Thomas",
    specialization: "Endocrinology",
    defaultConsultMins: 12,
    photoUrl: portrait(16),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000018",
    departmentId: DEPARTMENTS[14].id,
    name: "Dr. Rajesh Khanna",
    specialization: "Interventional Cardiology",
    defaultConsultMins: 14,
    photoUrl: portrait(17),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000019",
    departmentId: DEPARTMENTS[15].id,
    name: "Dr. Shalini Bhatt",
    specialization: "Stroke & Epilepsy",
    defaultConsultMins: 16,
    photoUrl: portrait(18),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000020",
    departmentId: DEPARTMENTS[16].id,
    name: "Dr. Nikhil Save",
    specialization: null,
    defaultConsultMins: 9,
    photoUrl: portrait(19),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000021",
    departmentId: DEPARTMENTS[17].id,
    name: "Dr. Ayesha Shaikh",
    specialization: "Spine Surgery",
    defaultConsultMins: 15,
    photoUrl: portrait(20),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000022",
    departmentId: DEPARTMENTS[18].id,
    name: "Dr. Manav Trivedi",
    specialization: "Clinical Dermatology",
    defaultConsultMins: 11,
    photoUrl: portrait(21),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000023",
    departmentId: DEPARTMENTS[19].id,
    name: "Dr. Pooja Rane",
    specialization: "Neonatology",
    defaultConsultMins: 13,
    photoUrl: portrait(22),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000024",
    departmentId: DEPARTMENTS[20].id,
    name: "Dr. Karan Mehra",
    specialization: "Rhinology",
    defaultConsultMins: 14,
    photoUrl: portrait(23),
  },
  {
    id: "cccccccc-0000-4000-8000-000000000025",
    departmentId: DEPARTMENTS[21].id,
    name: "Dr. Sunita Pillai",
    specialization: null,
    defaultConsultMins: 8,
    photoUrl: portrait(24),
  },
] as const;

/** Every doctor works every day, so a freshly seeded database always has sessions today. */
const SCHEDULES = DOCTORS.flatMap((doctor, index) =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    id: `dddddddd-${String(index).padStart(4, "0")}-4000-8000-${String(weekday).padStart(12, "0")}`,
    doctorId: doctor.id,
    weekday,
    startTime: index % 2 === 0 ? "10:00" : "15:00",
    endTime: index % 2 === 0 ? "13:00" : "18:00",
    // Cycled rather than climbing with the index. Unbounded, the 25th doctor billed
    // 2,900 rupees for an OPD visit; a fee sits on every card in discovery, so a
    // number nobody would believe makes the whole screen read as fake. Eight steps
    // of 150 gives 400-1,450 - a real spread across a metro, all of it plausible.
    defaultFeePaise: 40_000 + (index % 8) * 15_000,
  })),
);

const DEMO_PASSWORD = "Demo@12345";
const STAFF = [
  {
    id: "eeeeeeee-0000-4000-8000-000000000001",
    email: "admin@apollo.test",
    hospitalId: HOSPITALS[0].id,
    role: "ADMIN" as const,
  },
  {
    id: "eeeeeeee-0000-4000-8000-000000000002",
    email: "reception@apollo.test",
    hospitalId: HOSPITALS[0].id,
    role: "RECEPTION" as const,
  },
  {
    id: "eeeeeeee-0000-4000-8000-000000000003",
    email: "admin@fortis.test",
    hospitalId: HOSPITALS[1].id,
    role: "ADMIN" as const,
  },
  // Phase 6: the doctor console resolves the signed-in account to a Doctor row, so
  // without a DOCTOR membership LINKED to one there was no way to open it at all.
  // Linked to Dr. Anita Sharma, who runs the 10:00 Apollo cardiology session.
  {
    id: "eeeeeeee-0000-4000-8000-000000000004",
    email: "doctor@apollo.test",
    hospitalId: HOSPITALS[0].id,
    role: "DOCTOR" as const,
    doctorId: DOCTORS[0].id,
  },
  // A second hospital with a working reception console, so tenant scoping can be
  // seen rather than only asserted: this login must not be able to reach Apollo.
  {
    id: "eeeeeeee-0000-4000-8000-000000000005",
    email: "reception@max.test",
    hospitalId: HOSPITALS[2].id,
    role: "RECEPTION" as const,
  },
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
const PATIENT_ACCOUNT = { email: "testpatient@apollo.test" } as const;
const PATIENT_PROFILES = [
  {
    id: "88888888-0000-4000-8000-000000000001",
    name: "Test Patient",
    relation: "SELF" as const,
    gender: "MALE" as const,
  },
  {
    id: "88888888-0000-4000-8000-000000000002",
    name: "Asha Semwal",
    relation: "MOTHER" as const,
    gender: "FEMALE" as const,
  },
  {
    id: "88888888-0000-4000-8000-000000000003",
    name: "Rohan Semwal",
    relation: "CHILD" as const,
    gender: "MALE" as const,
  },
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
  "Ramesh Gupta",
  "Sunita Patil",
  "Imtiaz Khan",
  "Deepa Nair",
  "Harpreet Singh",
  "Lata Mishra",
] as const;

const WALK_IN_PLAN = [
  {
    status: "COMPLETED" as const,
    joined: 74,
    checkedIn: 72,
    called: 64,
    started: 63,
    completed: 51,
  },
  {
    status: "COMPLETED" as const,
    joined: 69,
    checkedIn: 67,
    called: 50,
    started: 49,
    completed: 38,
  },
  {
    status: "IN_CONSULTATION" as const,
    joined: 64,
    checkedIn: 60,
    called: 9,
    started: 7,
  },
  { status: "CHECKED_IN" as const, joined: 58, checkedIn: 34 },
  { status: "CHECKED_IN" as const, joined: 52, checkedIn: 21 },
  // Called twice and never appeared. recallCount is what the no-show rule counts.
  {
    status: "NO_SHOW" as const,
    joined: 46,
    checkedIn: 40,
    called: 18,
    recallCount: 2,
  },
] as const;

/**
 * The patient account's own bookings - one per hospital, rotating through the
 * three profiles, so My Visits has a live booking, an arrival, a past visit and a
 * cancellation to show, and "For <name>" has more than one name to get right.
 */
/**
 * Other people's bookings.
 *
 * Before this, a live queue was six anonymous walk-ins and you - which hides the one
 * distinction the whole product turns on. `checkedInCount` and `bookedNotArrivedCount`
 * are separate numbers because "8 waiting" is a half-truth when five of them are still
 * at home (docs/PRD.md 7.3), and with nobody else booked online there was never a
 * second number to show.
 *
 * Real accounts with real Payment rows, not bare rows: a token exists because somebody
 * paid for it, and a fixture that skips the money teaches the wrong shape.
 */
const OTHER_PATIENTS = [
  {
    id: "99999999-0000-4000-8000-000000000001",
    email: "priya.nair@patient.test",
    name: "Priya Nair",
  },
  {
    id: "99999999-0000-4000-8000-000000000002",
    email: "arjun.rao@patient.test",
    name: "Arjun Rao",
  },
  {
    id: "99999999-0000-4000-8000-000000000003",
    email: "fatima.sheikh@patient.test",
    name: "Fatima Sheikh",
  },
  {
    id: "99999999-0000-4000-8000-000000000004",
    email: "vivek.menon@patient.test",
    name: "Vivek Menon",
  },
] as const;

/**
 * Three more online seats per live session, deliberately mixed.
 *
 * One has arrived and one has not, so every session shows a non-zero count on BOTH
 * sides of that split rather than only the one the seed happened to pick.
 */
const OTHER_BOOKINGS = [
  { status: "CHECKED_IN" as const, joined: 55, checkedIn: 20 },
  { status: "CONFIRMED" as const, joined: 38 },
  { status: "CONFIRMED" as const, joined: 16 },
] as const;

const ONLINE_PLAN = [
  { status: "CONFIRMED" as const, profile: 0, joined: 30 },
  { status: "CHECKED_IN" as const, profile: 1, joined: 44, checkedIn: 12 },
  { status: "CONFIRMED" as const, profile: 2, joined: 26 },
  {
    status: "COMPLETED" as const,
    profile: 0,
    joined: 82,
    checkedIn: 77,
    called: 31,
    started: 30,
    completed: 20,
  },
  { status: "CONFIRMED" as const, profile: 1, joined: 18 },
  { status: "CANCELLED" as const, profile: 2, joined: 90 },
] as const;

async function assertSafeToSeed(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("refusing to seed: NODE_ENV is production");
  }

  const seededIds: string[] = HOSPITALS.map((h) => h.id);
  const foreign = await prisma.hospital.count({
    where: { id: { notIn: seededIds } },
  });
  if (foreign > 0) {
    throw new Error(
      `refusing to seed: the database holds ${foreign} hospital(s) this script did not create. ` +
        "That looks like real data.",
    );
  }
}

async function main(): Promise<void> {
  await assertSafeToSeed();

  for (const hospital of HOSPITALS) {
    await prisma.hospital.upsert({
      where: { id: hospital.id },
      update: {
        name: hospital.name,
        city: hospital.city,
        area: hospital.area,
        photoUrl: hospital.photoUrl,
      },
      create: { ...hospital, status: "VERIFIED" },
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

  const departmentHospital = new Map(
    DEPARTMENTS.map((d) => [d.id, d.hospitalId] as const),
  );
  for (const doctor of DOCTORS) {
    const hospitalId = departmentHospital.get(doctor.departmentId)!;
    await prisma.doctor.upsert({
      where: { id: doctor.id },
      update: {
        name: doctor.name,
        specialization: doctor.specialization,
        photoUrl: doctor.photoUrl,
      },
      create: { ...doctor, hospitalId },
    });
  }

  const doctorHospital = new Map(
    DOCTORS.map(
      (d) => [d.id, departmentHospital.get(d.departmentId)!] as const,
    ),
  );
  for (const schedule of SCHEDULES) {
    await prisma.doctorSchedule.upsert({
      where: { id: schedule.id },
      update: {
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        // Was missing, so a changed fee never reached an existing row and re-seeding
        // left the database disagreeing with this file.
        defaultFeePaise: schedule.defaultFeePaise,
      },
      create: {
        ...schedule,
        hospitalId: doctorHospital.get(schedule.doctorId)!,
      },
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
      where: {
        hospitalId_accountId: {
          hospitalId: member.hospitalId,
          accountId: account.id,
        },
      },
      update: { role: member.role, status: "ACTIVE" },
      create: {
        id: member.id,
        hospitalId: member.hospitalId,
        accountId: account.id,
        role: member.role,
        status: "ACTIVE",
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
      update: {
        name: profile.name,
        relation: profile.relation,
        gender: profile.gender,
      },
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
      departmentId: DOCTORS.find((d) => d.id === schedule.doctorId)!
        .departmentId,
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
    const doctor = DOCTORS.find(
      (d) => departmentHospital.get(d.departmentId) === hospital.id,
    )!;
    const columns = {
      hospitalId: hospital.id,
      departmentId: doctor.departmentId,
      originalDoctorId: doctor.id,
      currentProviderDoctorId: doctor.id,
      date: dateColumnFromString(date),
      scheduledStart: liveStart,
      scheduledEnd: liveEnd,
      feePaise: 60_000,
      tokenPrefix: "B",
    };
    // ACTIVE with the doctor PRESENT, because the queue below has somebody
    // IN_CONSULTATION - and since the ON_BREAK fix, calling and starting are
    // refused unless the doctor is present. A seeded state that the engine would
    // reject is a fixture that teaches the wrong thing.
    const live = {
      ...columns,
      status: "ACTIVE" as const,
      doctorPresence: "PRESENT" as const,
    };
    await prisma.oPDSession.upsert({
      where: {
        id: `ffffffff-0000-4000-8000-${String(index).padStart(12, "0")}`,
      },
      update: {
        scheduledStart: liveStart,
        scheduledEnd: liveEnd,
        date: columns.date,
        status: "ACTIVE",
        doctorPresence: "PRESENT",
      },
      create: {
        id: `ffffffff-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ...live,
      },
    });
  }

  /**
   * The stored check-in reference.
   *
   * `QueueEntry.checkInCode` holds the raw 24-byte reference; the API wraps it in a
   * signature on READ (`signCheckInCode` in common/checkin-code.ts), so the seed must
   * store the bare value and never a signed one.
   *
   * **The seed never wrote one at all until now**, which meant every seeded booking
   * showed "your QR code appears once payment is confirmed" - on paid bookings. The
   * token screen is the hero of the whole app and it has never had a QR on it.
   *
   * Derived from the entry id rather than random, so re-seeding does not invalidate a
   * code somebody has already screenshotted.
   */
  const checkInRef = (entryId: string): string =>
    createHash("sha256")
      .update(`checkin:${entryId}`)
      .digest("base64url")
      .slice(0, 32);

  // --- fill those live sessions with a clinic already in progress ------------
  const minsAgo = (mins: number): Date => new Date(Date.now() - mins * 60_000);
  const pad = (value: number, width: number): string =>
    String(value).padStart(width, "0");
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
        create: { id: patientId, name: patientName, relation: "SELF" },
      });

      const tokenNumber = seat + 1;
      await prisma.queueEntry.upsert({
        where: {
          id: `76767676-${pad(index, 4)}-4000-8000-${pad(tokenNumber, 12)}`,
        },
        update: { status: plan.status },
        create: {
          id: `76767676-${pad(index, 4)}-4000-8000-${pad(tokenNumber, 12)}`,
          hospitalId: hospital.id,
          sessionId,
          patientId,
          tokenNumber,
          tokenLabel: `B${pad(tokenNumber, 3)}`,
          type: "WALK_IN",
          status: plan.status,
          recallCount: "recallCount" in plan ? plan.recallCount : 0,
          joinedAt: minsAgo(plan.joined),
          checkedInAt: "checkedIn" in plan ? minsAgo(plan.checkedIn) : null,
          calledAt: "called" in plan ? minsAgo(plan.called) : null,
          consultStartedAt: "started" in plan ? minsAgo(plan.started) : null,
          completedAt: "completed" in plan ? minsAgo(plan.completed) : null,
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
      update: {
        status: online.status,
        // Was missing, so the code never reached a row that already existed - which
        // is every row on any machine that had seeded before. The same convergence
        // bug as DoctorSchedule.defaultFeePaise, and it hid the QR on the one screen
        // the whole app is built around.
        checkInCode: online.status === "CANCELLED" ? null : checkInRef(entryId),
      },
      create: {
        id: entryId,
        hospitalId: hospital.id,
        sessionId,
        patientId: PATIENT_PROFILES[online.profile].id,
        accountId: patientAccount.id,
        tokenNumber,
        tokenLabel: `B${pad(tokenNumber, 3)}`,
        type: "ONLINE",
        status: online.status,
        // Cancelled bookings lose their code; everything else has been paid for.
        checkInCode: online.status === "CANCELLED" ? null : checkInRef(entryId),
        joinedAt: minsAgo(online.joined),
        checkedInAt: "checkedIn" in online ? minsAgo(online.checkedIn) : null,
        calledAt: "called" in online ? minsAgo(online.called) : null,
        consultStartedAt: "started" in online ? minsAgo(online.started) : null,
        completedAt: "completed" in online ? minsAgo(online.completed) : null,
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
        status: online.status === "CANCELLED" ? "REFUNDED" : "SUCCESS",
        refundedPaise: online.status === "CANCELLED" ? 60_000 : 0,
        razorpayOrderId: `order_seed_${pad(index, 4)}`,
        razorpayPaymentId: `pay_seed_${pad(index, 4)}`,
      },
    });

    // --- three more seats, belonging to other people --------------------------
    //
    // Rotated by hospital so the same three names do not appear in every queue, and
    // so the board a receptionist opens reads like a clinic rather than a fixture.
    for (const [slot, plan] of OTHER_BOOKINGS.entries()) {
      const person = OTHER_PATIENTS[(index + slot) % OTHER_PATIENTS.length]!;
      const otherToken = WALK_IN_PLAN.length + 2 + slot;
      const otherEntryId = `76767676-${pad(index, 4)}-4000-8000-${pad(otherToken, 12)}`;
      const patientId = `9a9a9a9a-${pad(index, 4)}-4000-8000-${pad(slot, 12)}`;

      // A separate Account per person: these are other app users, not walk-ins, and
      // the queue must be able to tell "booked online but not here" from "at the desk".
      const account = await prisma.account.upsert({
        where: { email: person.email },
        update: {},
        create: { id: person.id, email: person.email, passwordHash },
      });
      await prisma.patient.upsert({
        where: { id: patientId },
        update: { name: person.name },
        create: {
          id: patientId,
          accountId: account.id,
          name: person.name,
          relation: "SELF",
        },
      });

      await prisma.queueEntry.upsert({
        where: { id: otherEntryId },
        update: { status: plan.status, checkInCode: checkInRef(otherEntryId) },
        create: {
          id: otherEntryId,
          hospitalId: hospital.id,
          sessionId,
          patientId,
          accountId: account.id,
          tokenNumber: otherToken,
          tokenLabel: `B${pad(otherToken, 3)}`,
          type: "ONLINE",
          status: plan.status,
          checkInCode: checkInRef(otherEntryId),
          joinedAt: minsAgo(plan.joined),
          checkedInAt: "checkedIn" in plan ? minsAgo(plan.checkedIn) : null,
        },
      });
      entryCount += 1;

      await prisma.payment.upsert({
        where: { queueEntryId: otherEntryId },
        update: {},
        create: {
          id: `65656565-${pad(index, 4)}-4000-8000-${pad(otherToken, 12)}`,
          hospitalId: hospital.id,
          queueEntryId: otherEntryId,
          accountId: account.id,
          amountPaise: 60_000,
          status: "SUCCESS",
          razorpayOrderId: `order_seed_o${pad(index, 3)}${slot}`,
          razorpayPaymentId: `pay_seed_o${pad(index, 3)}${slot}`,
        },
      });
    }
  }

  console.log(
    [
      `seeded ${HOSPITALS.length} hospitals, ${DEPARTMENTS.length} departments, ` +
        `${DOCTORS.length} doctors, ${SCHEDULES.length} schedules`,
      `sessions for ${date} (IST): ${count} created, ${todays.length - count} already present`,
      `plus ${HOSPITALS.length} live-now session(s) so discovery has an OPEN card to show`,
      `${entryCount} queue entries across them: ${WALK_IN_PLAN.length} walk-ins + ` +
        `1 booking for the test account + ${OTHER_BOOKINGS.length} from other accounts, each`,
      `other patient logins: ${OTHER_PATIENTS.map((p) => p.email).join(", ")} / ${DEMO_PASSWORD}`,
      `cities: ${[...new Set(HOSPITALS.map((h) => h.city))].join(", ")}`,
      `staff logins: ${STAFF.map((s) => s.email).join(", ")} / ${DEMO_PASSWORD}`,
      `patient login: ${PATIENT_ACCOUNT.email} / ${DEMO_PASSWORD} ` +
        `(${PATIENT_PROFILES.length} profiles: ${PATIENT_PROFILES.map((p) => p.name).join(", ")})`,
    ].join("\n"),
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
