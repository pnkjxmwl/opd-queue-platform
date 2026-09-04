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
  QueueEntryStatus,
  QueueSnapshot,
  SessionCard,
  SessionCardQuery,
  SessionDetail,
} from '@opd/contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { registrationGate } from '../../common/registration';
import { ELIGIBLE_TO_CALL, HOLDS_A_SLOT } from '../queue/state-machine';
import { QueuePolicyService } from '../config/queue-policy.service';
import { EtaService } from '../eta/eta.service';
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
  currentProvider: {
    select: { id: true, name: true, specialization: true, defaultConsultMins: true, photoUrl: true },
  },
} as const;

type SessionRow = Prisma.OPDSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

/**
 * Whether the server would accept a join right now (docs/PRD.md 8.12).
 *
 * **Phase 5 moved this rule out of this file.** It lives in
 * `common/registration.ts` now and is shared with the JOIN command, because the
 * button and the write have to agree: a card saying Open over a session the server
 * then refuses is worse than a card saying Closed. That function is pure, so all
 * this module adds is the data it needs - the hospital's policy, and how many online
 * tokens are already held.
 *
 * Still advisory (docs/Rules.md 1): the answer can change between this read and the
 * join, which is exactly why the join re-runs it under the session lock.
 *
 * One historical note kept because it is a trap: ACTIVE belongs in the open set. The
 * first `call-next` activates a session, so leaving it out would close every clinic
 * the moment it opened its doors.
 */

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: QueuePolicyService,
    private readonly eta: EtaService,
  ) {}

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
        photoUrl: row.photoUrl,
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
      photoUrl: row.photoUrl,
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

    const now = new Date();
    const snapshots = await this.snapshots([row], now);

    return {
      ...toCardDto(row, snapshots.get(row.id)!),
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
    const snapshots = await this.snapshots(rows, now);

    return {
      items: rows.map((row) => toCardDto(row, snapshots.get(row.id)!)),
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
   * **The ONE place per-card queue numbers are produced**, and the hottest read path
   * in the product. Two queries per PAGE - never one per card, which is the N+1
   * docs/Phases.md names as this module's standing risk:
   *
   *   1. one `groupBy` over `QueueEntry.status`, keyed by sessionId, for the counts
   *   2. one small lookup for the token being served, which is at most one row per
   *      session because `call-next` refuses to call anyone while a patient is
   *      still CALLED or IN_CONSULTATION
   *
   * Phase 7 fills `joinNowEtaFrom`/`To` from the ETA engine; no call site changes.
   */
  private async snapshots(rows: SessionRow[], now: Date): Promise<Map<string, QueueSnapshot>> {
    const sessionIds = rows.map((row) => row.id);
    const empty = (): QueueSnapshot => ({
      nowServingToken: null,
      checkedInCount: 0,
      bookedNotArrivedCount: 0,
      // Filled below, by the same gate the JOIN command uses (docs/PRD.md 8.12).
      registrationOpen: false,
      joinNowEtaFrom: null,
      joinNowEtaTo: null,
    });

    const snapshots = new Map(sessionIds.map((id) => [id, empty()]));
    if (sessionIds.length === 0) return snapshots;

    // Two plain reads rather than one $transaction([...]).
    //
    // Typing, first: a groupBy inside the array form loses its row shape and
    // `_count._all` stops existing - the same failure as trap 13 in
    // docs/PROGRESS.md, from the same cause (the literal no longer drives the
    // inference). Awaited directly, it keeps its type with no cast.
    //
    // And consistency is not worth buying here: the two queries can land either side
    // of a call-next, so a card may show a token whose count moved a moment ago.
    // This is a projection of a queue that changes every few seconds and is already
    // stale by the time it reaches a phone; paying an interactive transaction on the
    // hottest read path in the product to align two numbers nobody can perceive
    // would be the wrong trade.
    const [counts, serving, held] = await Promise.all([
      this.prisma.queueEntry.groupBy({
        by: ['sessionId', 'status'],
        where: { sessionId: { in: sessionIds }, status: { in: [...COUNTED_STATUSES] } },
        // Prisma requires an orderBy once more than one field is grouped by. It has
        // no effect on the folding below; it is here to satisfy the overload.
        orderBy: [{ sessionId: 'asc' }, { status: 'asc' }],
        _count: { _all: true },
      }),
      this.prisma.queueEntry.findMany({
        where: { sessionId: { in: sessionIds }, status: { in: ['CALLED', 'IN_CONSULTATION'] } },
        // Phase 7 added the last two, in the query that was already being made:
        // the ETA needs to know how long the person in the room has been in it.
        select: { sessionId: true, tokenLabel: true, status: true, consultStartedAt: true },
      }),
      // Online bookings holding a slot, for maxOnlineTokens. Grouped across the
      // whole page, never one query per card. A lapsed unpaid hold is excluded
      // whether or not the sweeper has reached it - the column frees the slot.
      this.prisma.queueEntry.groupBy({
        by: ['sessionId'],
        where: {
          sessionId: { in: sessionIds },
          type: 'ONLINE',
          status: { in: [...HOLDS_A_SLOT] },
          NOT: { status: 'RESERVED', reservationExpiresAt: { lte: now } },
        },
        orderBy: { sessionId: 'asc' },
        _count: { _all: true },
      }),
    ]);

    // Eligible-only, kept separately from checkedInCount: that count includes the
    // patient who has been CALLED, and the ETA already accounts for them through the
    // consultation clock. Adding them to both would charge a newcomer twice for the
    // same person.
    const eligibleAhead = new Map(sessionIds.map((id) => [id, 0]));

    for (const group of counts) {
      const snapshot = snapshots.get(group.sessionId);
      if (snapshot === undefined) continue;
      if (PRESENT_STATUSES.includes(group.status)) {
        snapshot.checkedInCount += group._count._all;
        if (ELIGIBLE_TO_CALL.includes(group.status)) {
          eligibleAhead.set(group.sessionId, (eligibleAhead.get(group.sessionId) ?? 0) + group._count._all);
        }
      } else {
        snapshot.bookedNotArrivedCount += group._count._all;
      }
    }

    const consultingSince = new Map<string, Date | null>();
    for (const row of serving) {
      const snapshot = snapshots.get(row.sessionId);
      if (snapshot !== undefined) snapshot.nowServingToken = row.tokenLabel;
      if (row.status === 'IN_CONSULTATION') {
        consultingSince.set(row.sessionId, row.consultStartedAt);
      }
    }

    const heldBySession = new Map(held.map((group) => [group.sessionId, group._count._all]));

    // One policy read per HOSPITAL on the page rather than per card - a page of
    // session cards is usually one or two hospitals.
    const policies = new Map(
      await Promise.all(
        [...new Set(rows.map((row) => row.hospitalId))].map(
          // read, NOT ensure: this module writes nothing, and `ensure` inserts a
          // row on first use - which would let a patient browsing create one.
          async (id) => [id, await this.policies.read(id)] as const,
        ),
      ),
    );

    // P7-BE-03 · "if I joined right now, when would I be seen?"
    //
    // One batched call for the whole page - three queries however many cards are on
    // it - which is the same rule the rest of this method follows and the reason the
    // ETA service takes a list rather than a session.
    //
    // Computed BEFORE the registration gate, because the gate now consumes it: a
    // session whose queue already runs past its own end has to stop taking bookings
    // (docs/PRD.md 8.12, `cutoffOnEtaOverrun`).
    const windows = await this.eta.windowsFor(
      rows.map((row) => ({
        key: row.id,
        sessionId: row.id,
        doctorId: row.currentProviderDoctorId,
        aheadCount: eligibleAhead.get(row.id) ?? 0,
        currentStartedAt: consultingSince.get(row.id) ?? null,
        estimable:
          (row.status === 'OPEN_FOR_REGISTRATION' || row.status === 'ACTIVE') &&
          row.doctorPresence !== 'LEFT',
      })),
      now,
    );

    for (const row of rows) {
      const snapshot = snapshots.get(row.id);
      const policy = policies.get(row.hospitalId);
      if (snapshot === undefined || policy === undefined) continue;

      const window = windows.get(row.id) ?? null;
      // P8-BE-04 · the fourth cutoff mechanism, live at last.
      //
      // The EARLY edge of the window, not the late one: closing the doors is a
      // decision against the patient, so it should take the optimistic estimate
      // running out, not merely the pessimistic one.
      //
      // The `cutoff` worker independently CLOSES such a session, which persists the
      // decision, audits it and broadcasts it. This is the same rule applied at read
      // time so a card is right immediately rather than within a minute - and it is
      // the same function deciding, so the two cannot disagree.
      const etaOverrun =
        policy.cutoffOnEtaOverrun && window !== null && new Date(window.from) > row.scheduledEnd;

      snapshot.registrationOpen = registrationGate({
        status: row.status,
        registrationClosedAt: row.registrationClosedAt,
        scheduledEnd: row.scheduledEnd,
        policy: {
          cutoffMinsBeforeEnd: policy.cutoffMinsBeforeEnd,
          maxOnlineTokens: policy.maxOnlineTokens,
        },
        onlineTokensHeld: heldBySession.get(row.id) ?? 0,
        etaOverrun,
        now,
      }).open;

      // A time is only offered on a card somebody can actually act on. Showing one
      // beside a disabled Join button is an invitation to nothing.
      if (window !== null && snapshot.registrationOpen) {
        snapshot.joinNowEtaFrom = window.from;
        snapshot.joinNowEtaTo = window.to;
      }
    }

    return snapshots;
  }
}

/**
 * The two honest numbers from docs/PRD.md 4.2, and the exact statuses
 * `QueueSnapshot` in packages/contracts says each one covers.
 *
 * `checkedInCount` is people physically here and not yet finished - including the
 * one currently CALLED, who is still ahead of you. `bookedNotArrivedCount` is people
 * who may or may not turn up (docs/PRD.md 8.9), which is exactly why they are
 * counted separately rather than folded in: collapsing the two is what makes a queue
 * app feel like it is lying.
 *
 * RESERVED is in neither. An unpaid hold is not a booking, and showing it would
 * inflate the queue with people who never joined it.
 */
const PRESENT_STATUSES: QueueEntryStatus[] = ['CHECKED_IN', 'READY', 'CALLED'];
const AWAITED_STATUSES: QueueEntryStatus[] = ['CONFIRMED', 'VIRTUAL_WAITING'];
const COUNTED_STATUSES: QueueEntryStatus[] = [...PRESENT_STATUSES, ...AWAITED_STATUSES];

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
  photoUrl: row.photoUrl,
  defaultConsultMins: row.defaultConsultMins,
  departmentId: row.departmentId,
  departmentName: row.department.name,
  hospitalId: row.hospitalId,
  hospitalName: row.hospital.name,
  hospitalCity: row.hospital.city,
});

// No `now` any more: the only thing that needed a clock was registrationOpen, and
// that moved to the shared gate in snapshots(). A pure row -> card mapping again.
const toCardDto = (row: SessionRow, snapshot: QueueSnapshot): SessionCard => ({
  id: row.id,

  hospitalId: row.hospital.id,
  hospitalName: row.hospital.name,
  departmentId: row.department.id,
  departmentName: row.department.name,

  doctorId: row.currentProvider.id,
  doctorName: row.currentProvider.name,
  doctorSpecialization: row.currentProvider.specialization,
  doctorPhotoUrl: row.currentProvider.photoUrl,
  isSubstitute: row.currentProviderDoctorId !== row.originalDoctorId,

  // @db.Date comes back as UTC midnight; slicing the ISO string is the only safe
  // read (a locale formatter shifts the day west of UTC). See common/ist.ts.
  date: dateColumnToString(row.date),
  scheduledStart: row.scheduledStart.toISOString(),
  scheduledEnd: row.scheduledEnd.toISOString(),

  status: row.status,
  doctorPresence: row.doctorPresence,

  feePaise: row.feePaise,
  snapshot,
});
