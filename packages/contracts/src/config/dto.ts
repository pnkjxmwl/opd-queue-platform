import { z } from 'zod';
import { DoctorPresence, OrderingStrategy, RequeueBehavior, SessionStatus } from '../enums/config';
import { Email } from '../auth/dto';
import { PageQuery } from '../common/pagination';
import { Role, StaffStatus } from '../enums/staff';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * A local wall-clock time in Asia/Kolkata, "HH:mm", 24-hour, zero-padded.
 *
 * NOT an instant. A schedule of 10:00-13:00 is a rule about clock faces; it only
 * becomes a UTC instant when combined with a calendar date at session-generation
 * time. Storing it as a DateTime is the timezone bug docs/Phases.md warns about,
 * because a DateTime silently carries a date nobody meant.
 *
 * Zero-padding makes lexicographic comparison identical to chronological
 * comparison, which is why endTime > startTime is a plain string compare in both
 * Zod and the database CHECK constraint.
 */
export const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm (24-hour)');
export type ClockTime = z.infer<typeof ClockTime>;

/** A calendar date in Asia/Kolkata, "YYYY-MM-DD". Also not an instant. */
export const CalendarDate = z.string().date();
export type CalendarDate = z.infer<typeof CalendarDate>;

/**
 * A boolean in a query string. Only the exact string "true" enables it.
 *
 * NOT `z.coerce.boolean()`: coercion follows JS truthiness, so the string "false"
 * coerces to `true` - a filter that silently means the opposite of what it says.
 */
const QueryFlag = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/**
 * Listing config that can be deactivated. Deactivated rows are hidden by default;
 * without the opt-in there is no way back to a row you just deactivated.
 */
export const ConfigListQuery = PageQuery.extend({ includeInactive: QueryFlag });
export type ConfigListQuery = z.infer<typeof ConfigListQuery>;

/** docs/Rules.md 5: money is an integer count of paise. Never a float, never rupees. */
export const Paise = z.number().int().min(0).max(10_000_000);

// ---------------------------------------------------------------------------
// Department
// ---------------------------------------------------------------------------

export const Department = z.object({
  id: z.string().uuid(),
  name: z.string(),
  /**
   * Config is deactivated, never deleted. Doctors and sessions reference a
   * department with `onDelete: Restrict`, so a hard DELETE stops working the day
   * the department is used - permanently. DELETE therefore sets this to false.
   */
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Department = z.infer<typeof Department>;

export const CreateDepartmentRequest = z.object({
  name: z.string().trim().min(1).max(120),
});
export type CreateDepartmentRequest = z.infer<typeof CreateDepartmentRequest>;

/** `isActive` is here so a deactivated department can be brought back. */
export const UpdateDepartmentRequest = CreateDepartmentRequest.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateDepartmentRequest = z.infer<typeof UpdateDepartmentRequest>;

// ---------------------------------------------------------------------------
// Doctor
// ---------------------------------------------------------------------------

export const Doctor = z.object({
  id: z.string().uuid(),
  departmentId: z.string().uuid(),
  name: z.string(),
  specialization: z.string().nullable(),
  /** Cold-start seed for the ETA engine (docs/PRD.md 9). Per doctor, not per hospital. */
  defaultConsultMins: z.number().int().positive(),
  /** Whether this doctor has been invited and can log into the doctor console. */
  hasLogin: z.boolean(),
  /** Deactivated, never deleted - see Department.isActive. A doctor who leaves the
   *  hospital still owns every past session, so the row can never be removed. */
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
});
export type Doctor = z.infer<typeof Doctor>;

export const CreateDoctorRequest = z.object({
  departmentId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  specialization: z.string().trim().max(120).optional(),
  defaultConsultMins: z.number().int().min(1).max(240).default(10),
});
export type CreateDoctorRequest = z.infer<typeof CreateDoctorRequest>;

export const UpdateDoctorRequest = CreateDoctorRequest.partial().extend({
  isActive: z.boolean().optional(),
});
export type UpdateDoctorRequest = z.infer<typeof UpdateDoctorRequest>;

// ---------------------------------------------------------------------------
// Doctor schedule
// ---------------------------------------------------------------------------

/**
 * Exactly one of `weekday` (recurring) or `date` (one-off) is set - enforced here
 * AND by a database CHECK, because an application-only rule loses races.
 *
 * `weekday` is 0=Sunday..6=Saturday **evaluated in Asia/Kolkata**. A session
 * generated at 00:30 IST is 19:00 UTC the previous day; taking the weekday from a
 * UTC date would generate the wrong day's sessions every night.
 */
const recurrenceFields = {
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  date: CalendarDate.nullable().default(null),
};

const exactlyOneRecurrence = (v: { weekday: number | null; date: string | null }) =>
  (v.weekday === null) !== (v.date === null);

const RECURRENCE_MESSAGE = {
  message: 'Set exactly one of weekday (recurring) or date (one-off)',
  path: ['weekday'],
};

const ORDER_MESSAGE = { message: 'endTime must be after startTime', path: ['endTime'] };

export const DoctorSchedule = z.object({
  id: z.string().uuid(),
  doctorId: z.string().uuid(),
  weekday: z.number().int().min(0).max(6).nullable(),
  date: CalendarDate.nullable(),
  startTime: ClockTime,
  endTime: ClockTime,
  /** Copied onto each generated session; Phase 5 derives the payable amount from the session. */
  defaultFeePaise: z.number().int(),
  createdAt: z.string().datetime(),
});
export type DoctorSchedule = z.infer<typeof DoctorSchedule>;

const scheduleBody = {
  ...recurrenceFields,
  startTime: ClockTime,
  endTime: ClockTime,
  defaultFeePaise: Paise,
};

export const CreateDoctorScheduleRequest = z
  .object({ doctorId: z.string().uuid(), ...scheduleBody })
  .refine(exactlyOneRecurrence, RECURRENCE_MESSAGE)
  .refine((v) => v.endTime > v.startTime, ORDER_MESSAGE);
export type CreateDoctorScheduleRequest = z.infer<typeof CreateDoctorScheduleRequest>;

/**
 * Update replaces the mutable fields rather than patching them: "end after start"
 * and "exactly one recurrence" are cross-field rules that a partial body cannot be
 * validated against without first reading the stored row. Replacing is simpler than
 * merge-then-revalidate, and the admin form already holds every field.
 */
export const UpdateDoctorScheduleRequest = z
  .object(scheduleBody)
  .refine(exactlyOneRecurrence, RECURRENCE_MESSAGE)
  .refine((v) => v.endTime > v.startTime, ORDER_MESSAGE);
export type UpdateDoctorScheduleRequest = z.infer<typeof UpdateDoctorScheduleRequest>;

/** docs/Rules.md 6. `doctorId` narrows the list to one doctor's blocks. */
export const ScheduleListQuery = PageQuery.extend({
  doctorId: z.string().uuid().optional(),
});
export type ScheduleListQuery = z.infer<typeof ScheduleListQuery>;

// ---------------------------------------------------------------------------
// Queue policy - FROZEN SHAPE: the input to the entire Phase-4 queue engine
// ---------------------------------------------------------------------------

/**
 * Refund rules, stored as one JSON column (docs/Architecture.md 5.1, Rules.md 11.3).
 *
 * EVERY field has a default. That is not decoration: a row written today must still
 * parse after a later phase adds a field, and defaults are what make an old row
 * forward-compatible instead of a read-time crash in production.
 *
 * Percentages are integers 0-100 of the amount actually paid. Phase 5 computes the
 * refund; this only says how much.
 */
export const CancellationRules = z.object({
  /** Cancel at least this many minutes before the session starts -> full refund. */
  freeCancellationMins: z.number().int().min(0).max(10_080).default(120),
  /** Cancelled inside that window. */
  lateCancellationRefundPct: z.number().int().min(0).max(100).default(50),
  /** Booked, never arrived, session ended (docs/PRD.md 8.9). */
  noShowRefundPct: z.number().int().min(0).max(100).default(0),
  /** Hospital cancelled the session, or the doctor left early (docs/PRD.md 8.11). */
  sessionCancelledRefundPct: z.number().int().min(0).max(100).default(100),
});
export type CancellationRules = z.infer<typeof CancellationRules>;

/**
 * The per-hospital rules the Phase-4 engine reads on every decision. One row per
 * hospital. Every threshold the engine uses lives here - docs/Phases.md is explicit
 * that the engine hardcodes none of them.
 *
 * Each field is traceable to a locked rule in docs/PRD.md 8; nothing here is
 * speculative. The rules that need no configuration - token number is not call
 * order, a late check-in slots into its natural position, everything is audited -
 * deliberately have no knob, because making them configurable makes them breakable.
 */
export const QueuePolicyFields = z.object({
  /** PRD 8.3/8.5 - the policy, not the engine, owns ordering. */
  orderingStrategy: OrderingStrategy.default('TOKEN_ORDER'),

  /**
   * PRD 8.2 - only checked-in patients are callable, so the doctor never idles for
   * someone still at home. Turning it off makes booking alone enough to be called;
   * configurable because small clinics genuinely run that way.
   *
   * Engine semantics of `false`, pinned here so Phase 4 cannot guess: a booked entry
   * is callable without ever being checked in, and PRD 8.9 ("reservations that never
   * arrive are never called") is consequently unenforceable for that hospital.
   */
  checkInRequired: z.boolean().default(true),

  /** PRD 8.6 - walk-ins are auto-checked-in and appended in token order. */
  walkInEnabled: z.boolean().default(true),

  /** PRD 8.7 - audited priority/emergency insertion at the front of the queue. */
  priorityEnabled: z.boolean().default(true),

  // --- PRD 8.8: called, absent -> grace -> recall -> SKIPPED -> requeue ---
  /** How long a called patient has to appear before recall/skip begins. */
  gracePeriodSec: z.number().int().min(0).max(3_600).default(120),
  /** How many times staff may re-call before the entry is SKIPPED. */
  recallAttempts: z.number().int().min(0).max(5).default(1),
  /** END_OF_QUEUE moves the entry to the back of the checked-in pool; NO_REQUEUE
   *  terminates it as NO_SHOW, refunded by `cancellationRules.noShowRefundPct`. */
  requeueBehavior: RequeueBehavior.default('END_OF_QUEUE'),

  // --- PRD 8.12: registration cutoff ---
  //
  // Three INDEPENDENT limits, ANDed: registration stays open only while every
  // enabled one still permits a join. PRD 8.12 words them additively ("default ...
  // plus optional max_online_tokens, plus manual staff close"), so modelling them
  // as one either/or enum would let a hospital that wants a token cap silently lose
  // the ETA-overrun guard - and that guard is the product promise, not a setting.
  // Manual close is the third mechanism, is per-session rather than per-hospital,
  // and therefore lives on OPDSession.registrationClosedAt.
  /** Refuse a join whose own ETA would land after the session's scheduled end. */
  cutoffOnEtaOverrun: z.boolean().default(true),
  /** Also close this many minutes before scheduled end. null = no clock cutoff. */
  cutoffMinsBeforeEnd: z.number().int().min(0).max(720).nullable().default(null),
  /** Also cap remote bookings per session. null = uncapped. */
  maxOnlineTokens: z.number().int().min(1).max(1_000).nullable().default(null),

  /**
   * PRD 4.2 - the MVP's substitute for maps-based "leave now": tell the patient to
   * be at the hospital this many minutes before their ETA window opens. Phase 6/7
   * notifications read it. It is hospital configuration, and this is the table that
   * holds hospital configuration.
   */
  arriveBeforeMins: z.number().int().min(0).max(180).default(30),

  cancellationRules: CancellationRules.default({}),
});

export const QueuePolicy = QueuePolicyFields.extend({
  updatedAt: z.string().datetime(),
});
export type QueuePolicy = z.infer<typeof QueuePolicy>;

/**
 * PUT is a full replace. Every field defaults, so {} means "reset to defaults" and a
 * hospital that has never configured anything still yields a complete, valid policy.
 * The engine must never meet a missing or half-filled one.
 */
export const UpdateQueuePolicyRequest = QueuePolicyFields;
export type UpdateQueuePolicyRequest = z.infer<typeof UpdateQueuePolicyRequest>;

/**
 * The defaults, resolved once. The database columns deliberately carry NO defaults:
 * repeating them in Prisma would create a second source of truth that drifts.
 */
export const DEFAULT_QUEUE_POLICY: UpdateQueuePolicyRequest = QueuePolicyFields.parse({});

// ---------------------------------------------------------------------------
// OPD session
// ---------------------------------------------------------------------------

export const OPDSession = z.object({
  id: z.string().uuid(),
  departmentId: z.string().uuid(),
  /** Set when generated from a schedule; null when created by hand. */
  scheduleId: z.string().uuid().nullable(),
  /** Who the session was booked with - preserved across substitution (PRD 8.11). */
  originalDoctorId: z.string().uuid(),
  /** Who is actually seeing patients. Equal to the original until substituted. */
  currentProviderDoctorId: z.string().uuid(),
  /** The IST calendar date this session belongs to. */
  date: CalendarDate,
  /** UTC instants, derived from `date` plus the schedule's clock times. */
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
  status: SessionStatus,
  doctorPresence: DoctorPresence,
  /** Prefix for token labels, e.g. "A" -> "A027". */
  tokenPrefix: z.string(),
  feePaise: z.number().int(),
  /** Set when staff manually close registration (PRD 8.12, third mechanism). */
  registrationClosedAt: z.string().datetime().nullable(),
  /**
   * Set while the queue is paused; null when running (PRD 6.2).
   *
   * **Added in Phase 6, and it was a real hole.** `QueueCommandResult` has always
   * carried it, so the console saw a pause the moment it caused one - and then lost
   * it on the next page load, because the session READ did not return it. A paused
   * queue that looks unpaused after a refresh is a doctor pressing Call next and
   * being refused with no visible reason.
   */
  pausedAt: z.string().datetime().nullable(),
  version: z.number().int(),
});
export type OPDSession = z.infer<typeof OPDSession>;

/**
 * Manual session creation. There is no `status` field on purpose: creation always
 * produces OPEN_FOR_REGISTRATION and every later status change is a Phase-4 domain
 * command. docs/Rules.md 1.2 - no raw CRUD on OPDSession status.
 */
export const CreateOPDSessionRequest = z
  .object({
    doctorId: z.string().uuid(),
    date: CalendarDate,
    startTime: ClockTime,
    endTime: ClockTime,
    feePaise: Paise,
    tokenPrefix: z.string().trim().min(1).max(4).default('A'),
  })
  .refine((v) => v.endTime > v.startTime, ORDER_MESSAGE);
export type CreateOPDSessionRequest = z.infer<typeof CreateOPDSessionRequest>;

/**
 * Generate sessions from schedules. Idempotent: re-running for the same date creates
 * nothing new (unique on doctor + date + start in the database), so the double-click
 * docs/Phases.md predicts is harmless.
 *
 * `date` omitted = today in Asia/Kolkata, computed on the SERVER. A client-supplied
 * "today" sent at 00:30 IST is still yesterday in UTC, which is exactly the bug
 * docs/Phases.md flags.
 */
export const GenerateSessionsRequest = z.object({
  date: CalendarDate.optional(),
  /** Limit generation to one schedule. Omitted = every schedule matching the date. */
  scheduleId: z.string().uuid().optional(),
});
export type GenerateSessionsRequest = z.infer<typeof GenerateSessionsRequest>;

export const GenerateSessionsResponse = z.object({
  created: z.array(OPDSession),
  /** Already existed - the visible proof that re-running changed nothing. */
  skipped: z.number().int().nonnegative(),
});
export type GenerateSessionsResponse = z.infer<typeof GenerateSessionsResponse>;

/** docs/Rules.md 6: sessions accumulate daily and must never come back unbounded. */
export const SessionListQuery = PageQuery.extend({
  date: CalendarDate.optional(),
  departmentId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  status: SessionStatus.optional(),
});
export type SessionListQuery = z.infer<typeof SessionListQuery>;

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const StaffMember = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  email: z.string().email(),
  role: Role,
  status: StaffStatus,
  /** Set when the invited account is a DOCTOR linked to a Doctor record. */
  doctorId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type StaffMember = z.infer<typeof StaffMember>;

/**
 * The result of inviting someone - returned ONCE, at invite time.
 *
 * MVP has no email channel (PRD 4.2 rules out SMS/WhatsApp and notifications are
 * push-only, to app users who by definition do not exist yet for an invitee), so
 * the admin receives the token and passes it on. Only its hash is stored, exactly
 * like a refresh token: a database leak must not yield usable invitations.
 */
export const StaffInvite = StaffMember.extend({
  inviteToken: z.string(),
  inviteExpiresAt: z.string().datetime(),
});
export type StaffInvite = z.infer<typeof StaffInvite>;

export const InviteStaffRequest = z
  .object({
    email: Email,
    role: Role,
    /** Required when role is DOCTOR: which Doctor record this login drives. */
    doctorId: z.string().uuid().optional(),
  })
  .refine((v) => v.role !== 'DOCTOR' || v.doctorId !== undefined, {
    message: 'doctorId is required when inviting a DOCTOR',
    path: ['doctorId'],
  });
export type InviteStaffRequest = z.infer<typeof InviteStaffRequest>;
