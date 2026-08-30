import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  City,
  DepartmentListQuery,
  DoctorSearchQuery,
  HospitalCard,
  HospitalDetail,
  HospitalSearchQuery,
  PageQuery,
  Paginated,
  PublicDepartment,
  PublicDoctor,
  QueueSnapshot,
  SessionCard,
  SessionCardQuery,
  SessionDetail,
} from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundError } from '../../common/errors';
import { dateColumnFromString, dateColumnToString, istToday } from '../../common/ist';

/**
 * A hospital a patient may see at all.
 *
 * PENDING means onboarding is unfinished and SUSPENDED means we have stopped it, so
 * neither belongs in a patient's search results - and everything below hangs off a
 * hospital, so filtering here also hides their departments, doctors and sessions.
 */
const LISTABLE_HOSPITAL = { status: 'VERIFIED' } as const;

/**
 * A session a patient may see.
 *
 * docs/Phases.md: "tenant leakage through discovery is easy to miss because this
 * path is deliberately public." The four conditions are the whole guard:
 *   - CANCELLED sessions are gone, not merely closed
 *   - the hospital is listable
 *   - the department has not been deactivated
 *   - the doctor actually running it has not been deactivated
 *
 * COMPLETED and ENDED_EARLY sessions deliberately REMAIN visible: a patient
 * browsing at 16:00 should see that the morning clinic ran and is over, rather than
 * an empty screen that looks like a broken app. The card carries the status, and
 * `registrationOpen` is false, so nothing about it invites a join.
 *
 * The doctor filter is on the CURRENT PROVIDER, not the original: after a
 * substitution (docs/PRD.md 8.11) the session is still running, and it is the person
 * in the room whose active flag decides whether it is real.
 */
const listableSession = (date?: Date): Prisma.OPDSessionWhereInput => ({
  status: { not: 'CANCELLED' },
  ...(date ? { date } : {}),
  hospital: LISTABLE_HOSPITAL,
  department: { isActive: true },
  currentProvider: { isActive: true },
});

/** Everything a card needs, in one round trip - never one query per card. */
const SESSION_INCLUDE = {
  hospital: { select: { id: true, name: true, area: true, address: true } },
  department: { select: { id: true, name: true } },
  currentProvider: { select: { id: true, name: true, specialization: true, defaultConsultMins: true } },
} as const;

type SessionRow = Prisma.OPDSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

/**
 * Whether the server would accept a join right now (docs/PRD.md 8.12).
 *
 * Phase 3 knows only the session-local half of the rule. The three policy limits -
 * ETA overrun, cutoffMinsBeforeEnd and maxOnlineTokens - are ANDed in by Phase 5,
 * because all three need queue data that does not exist until Phase 4. Widening
 * this is safe; it can only ever get stricter, never more permissive.
 */
const isRegistrationOpen = (row: SessionRow, now: Date): boolean =>
  row.status === 'OPEN_FOR_REGISTRATION' &&
  row.registrationClosedAt === null &&
  row.scheduledEnd > now;

/**
 * The patient-facing read model: cities, hospitals, departments, doctors and the
 * session cards that are the product's shop window (docs/Architecture.md 6.2).
 *
 * **Deliberate exception to docs/CLAUDE.md 3 (no cross-module table access).** This
 * module reads Hospital, Department, Doctor and OPDSession, which the config and
 * sessions modules own. The rule exists to stop two modules mutating the same
 * invariants; nothing here writes. Routing these reads through the owning services
 * would not work anyway: those methods are tenant-scoped to a staff membership and
 * apply the ADMIN visibility rules, while a card needs one aggregate join across all
 * four tables. Splitting it would reintroduce exactly the per-card N+1 that
 * docs/Phases.md names as this phase's main risk. Recorded in docs/PROGRESS.md.
 *
 * Authenticated but NOT tenant-scoped: no route here carries a :hospitalId segment,
 * so TenantGuard passes through by design (see the controller).
 */
@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // Cities
  // -------------------------------------------------------------------------

  async cities(query: PageQuery): Promise<Paginated<City>> {
    // ponytail: groups every listable hospital, then pages the result in memory.
    // The grouped set has one row per CITY, not per hospital, and the total needs
    // the full grouping regardless. Push take/skip into the query if this ever
    // spans hundreds of cities.
    const groups = await this.prisma.hospital.groupBy({
      by: ['city'],
      where: LISTABLE_HOSPITAL,
      _count: { _all: true },
      orderBy: { city: 'asc' },
    });

    return {
      items: groups
        .slice(query.offset, query.offset + query.limit)
        .map((group) => ({ name: group.city, hospitalCount: group._count._all })),
      total: groups.length,
      limit: query.limit,
      offset: query.offset,
    };
  }

  // -------------------------------------------------------------------------
  // Hospitals
  // -------------------------------------------------------------------------

  async hospitals(query: HospitalSearchQuery): Promise<Paginated<HospitalCard>> {
    const where: Prisma.HospitalWhereInput = {
      ...LISTABLE_HOSPITAL,
      // City is an exact match (it comes from GET /cities); area and name are
      // substring searches, because those are typed by hand.
      ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
      ...(query.area ? { area: { contains: query.area, mode: 'insensitive' } } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.hospital.findMany({
        where,
        orderBy: { name: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.hospital.count({ where }),
    ]);

    const counts = await this.todayCountsBy('hospitalId', rows.map((row) => row.id));

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        city: row.city,
        area: row.area,
        todaySessionCount: counts.get(row.id) ?? 0,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async hospital(id: string): Promise<HospitalDetail> {
    const row = await this.prisma.hospital.findFirst({ where: { id, ...LISTABLE_HOSPITAL } });
    // Same answer for "no such hospital" and "not listable" - a 404-vs-403 split
    // would tell a caller which unverified hospitals exist.
    if (!row) throw new NotFoundError('Hospital not found');

    const counts = await this.todayCountsBy('hospitalId', [row.id]);

    return {
      id: row.id,
      name: row.name,
      city: row.city,
      area: row.area,
      address: row.address,
      todaySessionCount: counts.get(row.id) ?? 0,
    };
  }

  // -------------------------------------------------------------------------
  // Departments
  // -------------------------------------------------------------------------

  async departments(query: DepartmentListQuery): Promise<Paginated<PublicDepartment>> {
    const where: Prisma.DepartmentWhereInput = {
      hospitalId: query.hospitalId,
      isActive: true,
      hospital: LISTABLE_HOSPITAL,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.department.findMany({
        where,
        orderBy: { name: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.department.count({ where }),
    ]);

    const counts = await this.todayCountsBy('departmentId', rows.map((row) => row.id));

    return {
      items: rows.map((row) => ({
        id: row.id,
        hospitalId: row.hospitalId,
        name: row.name,
        todaySessionCount: counts.get(row.id) ?? 0,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  // -------------------------------------------------------------------------
  // Doctors (the secondary browse path - docs/PRD.md 5.1)
  // -------------------------------------------------------------------------

  async doctors(query: DoctorSearchQuery): Promise<Paginated<PublicDoctor>> {
    const where: Prisma.DoctorWhereInput = {
      isActive: true,
      department: { isActive: true },
      hospital: {
        ...LISTABLE_HOSPITAL,
        ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
      },
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { specialization: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const include = {
      department: { select: { name: true } },
      hospital: { select: { name: true, city: true } },
    } as const;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.doctor.findMany({
        where,
        include,
        orderBy: { name: 'asc' },
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.doctor.count({ where }),
    ]);

    return {
      items: rows.map(toDoctorDto),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  async doctor(id: string): Promise<PublicDoctor> {
    const row = await this.prisma.doctor.findFirst({
      where: { id, isActive: true, department: { isActive: true }, hospital: LISTABLE_HOSPITAL },
      include: { department: { select: { name: true } }, hospital: { select: { name: true, city: true } } },
    });
    if (!row) throw new NotFoundError('Doctor not found');
    return toDoctorDto(row);
  }

  // -------------------------------------------------------------------------
  // Sessions - the joinable unit
  // -------------------------------------------------------------------------

  /** Today's cards for a department. `date` is resolved server-side when omitted. */
  sessionsForDepartment(
    departmentId: string,
    query: SessionCardQuery,
  ): Promise<Paginated<SessionCard>> {
    return this.listSessions({ departmentId }, query);
  }

  /**
   * The same list narrowed to one doctor - the tail of the secondary browse path.
   * Matches on the CURRENT PROVIDER, so a covering doctor sees the session they are
   * actually running rather than the one they are formally booked for.
   */
  sessionsForDoctor(doctorId: string, query: SessionCardQuery): Promise<Paginated<SessionCard>> {
    return this.listSessions({ currentProviderDoctorId: doctorId }, query);
  }

  async session(id: string): Promise<SessionDetail> {
    const row = await this.prisma.oPDSession.findFirst({
      where: { id, ...listableSession() },
      include: SESSION_INCLUDE,
    });
    if (!row) throw new NotFoundError('Session not found');

    const snapshots = await this.snapshots([row.id]);

    return {
      ...toCardDto(row, snapshots.get(row.id)!, new Date()),
      hospitalArea: row.hospital.area,
      hospitalAddress: row.hospital.address,
      doctorDefaultConsultMins: row.currentProvider.defaultConsultMins,
    };
  }

  private async listSessions(
    narrow: Prisma.OPDSessionWhereInput,
    query: SessionCardQuery,
  ): Promise<Paginated<SessionCard>> {
    // The client may ask for a date, but "today" is always the SERVER's IST today.
    // A phone at 00:15 IST still believes it is yesterday in UTC.
    const date = dateColumnFromString(query.date ?? istToday());
    const where = { ...narrow, ...listableSession(date) };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.oPDSession.findMany({
        where,
        include: SESSION_INCLUDE,
        orderBy: [{ scheduledStart: 'asc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.oPDSession.count({ where }),
    ]);

    const now = new Date();
    const snapshots = await this.snapshots(rows.map((row) => row.id));

    return {
      items: rows.map((row) => toCardDto(row, snapshots.get(row.id)!, now)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  // -------------------------------------------------------------------------
  // Aggregates - one query per page, never one per card
  // -------------------------------------------------------------------------

  /**
   * How many listable sessions each id has TODAY, from a single grouped query.
   *
   * docs/Phases.md names N+1 here as the risk of this phase: every card wants a
   * count, and doing that per card is one query per row on the hottest read path in
   * the product. Doing it per page is one query per page, forever.
   */
  private async todayCountsBy(
    key: 'hospitalId' | 'departmentId',
    ids: string[],
  ): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();

    const today = listableSession(dateColumnFromString(istToday()));
    const filter = { in: ids };

    // Branching rather than a computed key: Prisma infers each group row's shape
    // from the `by` literal, so a dynamic key costs the type safety that makes
    // `group.hospitalId` provably a string. Two calls, no casts.
    const pairs =
      key === 'hospitalId'
        ? (
            await this.prisma.oPDSession.groupBy({
              by: ['hospitalId'],
              where: { hospitalId: filter, ...today },
              _count: { _all: true },
            })
          ).map((group) => [group.hospitalId, group._count._all] as const)
        : (
            await this.prisma.oPDSession.groupBy({
              by: ['departmentId'],
              where: { departmentId: filter, ...today },
              _count: { _all: true },
            })
          ).map((group) => [group.departmentId, group._count._all] as const);

    return new Map(pairs);
  }

  /**
   * Live queue numbers for a page of sessions.
   *
   * ponytail: QueueEntry does not exist until Phase 4, so every count is zero and
   * both ETA bounds are null. This is the ONE place those numbers are produced -
   * Phase 4 replaces the body with a single groupBy over QueueEntry.status keyed by
   * sessionId, Phase 7 fills the window from the ETA engine, and every card and
   * detail response is filled at once with no call site touched.
   */
  private async snapshots(sessionIds: string[]): Promise<Map<string, QueueSnapshot>> {
    return new Map(
      sessionIds.map((id) => [
        id,
        {
          nowServingToken: null,
          checkedInCount: 0,
          bookedNotArrivedCount: 0,
          // Overwritten per row by toCardDto - the session-local half of PRD 8.12.
          registrationOpen: false,
          joinNowEtaFrom: null,
          joinNowEtaTo: null,
        },
      ]),
    );
  }
}

type DoctorRow = Prisma.DoctorGetPayload<{
  include: {
    department: { select: { name: true } };
    hospital: { select: { name: true; city: true } };
  };
}>;

const toDoctorDto = (row: DoctorRow): PublicDoctor => ({
  id: row.id,
  name: row.name,
  specialization: row.specialization,
  defaultConsultMins: row.defaultConsultMins,
  departmentId: row.departmentId,
  departmentName: row.department.name,
  hospitalId: row.hospitalId,
  hospitalName: row.hospital.name,
  hospitalCity: row.hospital.city,
});

const toCardDto = (row: SessionRow, snapshot: QueueSnapshot, now: Date): SessionCard => ({
  id: row.id,

  hospitalId: row.hospital.id,
  hospitalName: row.hospital.name,
  departmentId: row.department.id,
  departmentName: row.department.name,

  doctorId: row.currentProvider.id,
  doctorName: row.currentProvider.name,
  doctorSpecialization: row.currentProvider.specialization,
  isSubstitute: row.currentProviderDoctorId !== row.originalDoctorId,

  // @db.Date comes back as UTC midnight; slicing the ISO string is the only safe
  // read (a locale formatter shifts the day west of UTC). See common/ist.ts.
  date: dateColumnToString(row.date),
  scheduledStart: row.scheduledStart.toISOString(),
  scheduledEnd: row.scheduledEnd.toISOString(),

  status: row.status,
  doctorPresence: row.doctorPresence,

  feePaise: row.feePaise,
  snapshot: { ...snapshot, registrationOpen: isRegistrationOpen(row, now) },
});
