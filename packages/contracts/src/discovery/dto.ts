import { z } from 'zod';
import { PageQuery } from '../common/pagination';
import { CalendarDate } from '../config/dto';
import { DoctorPresence, SessionStatus } from '../enums/config';

/**
 * The patient-facing read model (docs/Architecture.md 6.2).
 *
 * Deliberately a SEPARATE set of shapes from the admin DTOs in ../config/dto, even
 * where the underlying table is the same. The admin console sees `isActive`, the
 * schedule a session came from and the hospital's own bookkeeping; a patient sees a
 * card. Reusing one DTO for both audiences is how an internal field ends up on a
 * public endpoint - so `Department` (admin) and `PublicDepartment` (patient) stay
 * separate shapes on purpose.
 *
 * Every list here paginates (docs/Rules.md 6).
 */

/** Free-text search. Trimmed and capped so a query string cannot carry a payload. */
const SearchText = z.string().trim().min(1).max(80);

// ---------------------------------------------------------------------------
// Live queue snapshot - FROZEN SHAPE, half of it filled by later phases
// ---------------------------------------------------------------------------

/**
 * What is happening in a session's queue right now.
 *
 * **The nullable fields are a contract decision, not an oversight** (docs/Phases.md,
 * Phase 3 risks). Phase 3 ships before the queue engine (Phase 4) and the ETA engine
 * (Phase 7) exist, so the counts are zero and the windows are null today. They are
 * declared now, at their final names and types, so Phase 7 fills them in without
 * changing a response shape an already-shipped mobile app depends on.
 *
 * The two counts are the honest two-number model from docs/PRD.md 4.2 / 7.3: a
 * patient is told how many people are physically present ahead of them AND how many
 * are booked but still at home, because collapsing those into one number is what
 * makes a queue app feel like it is lying.
 */
export const QueueSnapshot = z.object({
  /**
   * The token label currently in consultation, e.g. "A018". null when nobody has
   * been called yet. Phase 4 fills it.
   */
  nowServingToken: z.string().nullable(),

  /**
   * Physically present and still waiting to be seen - entries in CHECKED_IN, READY
   * or CALLED. Phase 4 fills it.
   */
  checkedInCount: z.number().int().nonnegative(),

  /**
   * Booked but not yet arrived - entries in CONFIRMED or VIRTUAL_WAITING. These
   * people may or may not turn up (docs/PRD.md 8.9), which is exactly why they are
   * counted separately rather than folded into the number above. Phase 4 fills it.
   */
  bookedNotArrivedCount: z.number().int().nonnegative(),

  /**
   * Whether the server would accept a join right now (docs/PRD.md 8.12).
   *
   * Advisory only. It exists so the client can disable the Join button with a
   * reason instead of reimplementing the rule - docs/Rules.md 1 still makes the
   * server the only thing that decides at join time, and the answer can change
   * between this read and that write.
   *
   * Phase 3 computes it from the session alone: status, the manual close flag, and
   * the scheduled end. Phase 5 ANDs in the three policy limits (ETA overrun,
   * cutoffMinsBeforeEnd, maxOnlineTokens), which all need queue data that does not
   * exist yet.
   */
  registrationOpen: z.boolean(),

  /**
   * When a patient joining *right now* would be seen, as a window rather than a
   * point (docs/Phases.md Phase 7: never emit a point). Both null until Phase 7.
   */
  joinNowEtaFrom: z.string().datetime().nullable(),
  joinNowEtaTo: z.string().datetime().nullable(),
});
export type QueueSnapshot = z.infer<typeof QueueSnapshot>;

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

/** A city with at least one listable hospital. Derived from hospitals, not a table. */
export const City = z.object({
  name: z.string(),
  hospitalCount: z.number().int().positive(),
});
export type City = z.infer<typeof City>;

// ---------------------------------------------------------------------------
// Hospital
// ---------------------------------------------------------------------------

export const HospitalCard = z.object({
  id: z.string().uuid(),
  name: z.string(),
  city: z.string(),
  area: z.string().nullable(),
  /** OPD sessions listable today - so a hospital with nothing on can say so. */
  todaySessionCount: z.number().int().nonnegative(),
});
export type HospitalCard = z.infer<typeof HospitalCard>;

export const HospitalDetail = HospitalCard.extend({
  address: z.string().nullable(),
});
export type HospitalDetail = z.infer<typeof HospitalDetail>;

export const HospitalSearchQuery = PageQuery.extend({
  city: SearchText.optional(),
  area: SearchText.optional(),
  /** Matches the hospital name, case-insensitively. */
  q: SearchText.optional(),
});
export type HospitalSearchQuery = z.infer<typeof HospitalSearchQuery>;

// ---------------------------------------------------------------------------
// Department
// ---------------------------------------------------------------------------

export const PublicDepartment = z.object({
  id: z.string().uuid(),
  hospitalId: z.string().uuid(),
  name: z.string(),
  todaySessionCount: z.number().int().nonnegative(),
});
export type PublicDepartment = z.infer<typeof PublicDepartment>;

/**
 * `GET /departments?hospitalId=` rather than the `GET /hospitals/:id/departments`
 * sketched in docs/Architecture.md 6.2.
 *
 * That path collides with the ADMIN route `GET /hospitals/:hospitalId/departments`
 * shipped in Phase 2 - Express matches on route shape, not parameter name, so one
 * of the two would silently shadow the other and a patient would get TenantGuard's
 * 403 instead of a department list. Same information, no ambiguity.
 */
export const DepartmentListQuery = PageQuery.extend({
  hospitalId: z.string().uuid(),
});
export type DepartmentListQuery = z.infer<typeof DepartmentListQuery>;

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

/** The secondary browse entry point (docs/PRD.md 5.1): find a doctor, then their sessions. */
export const PublicDoctor = z.object({
  id: z.string().uuid(),
  name: z.string(),
  specialization: z.string().nullable(),
  /** Roughly how long this doctor spends per patient - honest context before Phase 7. */
  defaultConsultMins: z.number().int().positive(),
  departmentId: z.string().uuid(),
  departmentName: z.string(),
  hospitalId: z.string().uuid(),
  hospitalName: z.string(),
  hospitalCity: z.string(),
});
export type PublicDoctor = z.infer<typeof PublicDoctor>;

export const DoctorSearchQuery = PageQuery.extend({
  /** Matches doctor name or specialization, case-insensitively. */
  q: SearchText.optional(),
  city: SearchText.optional(),
});
export type DoctorSearchQuery = z.infer<typeof DoctorSearchQuery>;

// ---------------------------------------------------------------------------
// Session - the joinable unit, and the product's shop window
// ---------------------------------------------------------------------------

/**
 * docs/PRD.md 5.1: the joinable unit is always a session, never a doctor. A doctor
 * running two blocks in a day is two cards, and a doctor with no OPD today is
 * simply absent from the list.
 *
 * Rendered by docs/Design.md 5.5.
 */
export const SessionCard = z.object({
  id: z.string().uuid(),

  hospitalId: z.string().uuid(),
  hospitalName: z.string(),
  departmentId: z.string().uuid(),
  departmentName: z.string(),

  /**
   * Who will actually be seeing patients - `currentProviderDoctorId`, not the
   * doctor the session was booked with. After a substitution (docs/PRD.md 8.11)
   * those differ, and a patient browsing now cares about who is in the room.
   */
  doctorId: z.string().uuid(),
  doctorName: z.string(),
  doctorSpecialization: z.string().nullable(),
  /** True when this session has been handed to a covering doctor. */
  isSubstitute: z.boolean(),

  /** IST calendar date; the two instants are UTC (docs/Rules.md 5). */
  date: CalendarDate,
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),

  status: SessionStatus,
  /** Independent of `status` by design (docs/PRD.md 8.10) - open, but nobody in the room. */
  doctorPresence: DoctorPresence,

  feePaise: z.number().int().nonnegative(),
  snapshot: QueueSnapshot,
});
export type SessionCard = z.infer<typeof SessionCard>;

/** The card plus what is worth a second screen but not worth sending per-card. */
export const SessionDetail = SessionCard.extend({
  hospitalArea: z.string().nullable(),
  hospitalAddress: z.string().nullable(),
  doctorDefaultConsultMins: z.number().int().positive(),
});
export type SessionDetail = z.infer<typeof SessionDetail>;

/**
 * `date` omitted means today in Asia/Kolkata, resolved on the SERVER. A client's
 * idea of today is wrong for the half-hour after IST midnight, which is the exact
 * bug docs/Phases.md flags for this project.
 */
export const SessionCardQuery = PageQuery.extend({
  date: CalendarDate.optional(),
});
export type SessionCardQuery = z.infer<typeof SessionCardQuery>;
