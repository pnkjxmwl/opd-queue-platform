import { z } from 'zod';
import { DoctorPresence, SessionStatus } from '../enums/config';
import { Gender } from '../enums/patient';
import { QueueEntryPriority, QueueEntryStatus, QueueEntryType } from '../enums/queue';

/**
 * The queue engine's command surface (docs/Architecture.md 6.4).
 *
 * Every write here is a COMMAND, never a status PATCH (docs/Rules.md 6). The server
 * decides what a command means; the client sends an intent and renders the result.
 *
 * **These shapes are for the doctor and staff consoles, which are authorised to see
 * the people in their own session's queue.** They carry a patient name and must
 * never be reused for a patient-facing response or a realtime broadcast - a queue
 * update sent to one patient must not carry another patient's PII (docs/Rules.md 8,
 * DPDP). The patient-facing shape is `QueueSnapshot` in ../discovery/dto.
 */

/**
 * A reason string on an audited action. Required where docs/PRD.md 8.7 says
 * "audited, with reason"; an empty or whitespace reason is not a reason.
 */
const Reason = z.string().trim().min(3).max(280);

/** Targets one entry in the session being commanded. */
const EntryTarget = z.object({ entryId: z.string().uuid() });

// ---------------------------------------------------------------------------
// Read shape
// ---------------------------------------------------------------------------

/**
 * One entry as the console sees it.
 *
 * `tokenNumber` is the immutable booking label, NOT the position in the queue
 * (docs/PRD.md 8.1). There is deliberately no `position` or `orderIndex` field: the
 * effective call order is computed from status + priority + token on every read and
 * is never stored, because a stored order is wrong the instant anything changes.
 */
export const QueueEntryView = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  tokenNumber: z.number().int().positive(),
  tokenLabel: z.string(),
  type: QueueEntryType,
  priority: QueueEntryPriority,
  status: QueueEntryStatus,
  /** How many times this entry was called and did not appear (docs/PRD.md 8.8). */
  recallCount: z.number().int().nonnegative(),
  joinedAt: z.string().datetime(),
  checkedInAt: z.string().datetime().nullable(),
  calledAt: z.string().datetime().nullable(),
  consultStartedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
});
export type QueueEntryView = z.infer<typeof QueueEntryView>;

/**
 * What every command returns: the session state the caller must re-render, plus the
 * entry the command touched.
 *
 * `entry` is null for the session-level commands (pause, resume, presence). A
 * `call-next` with nobody eligible is an error, not a null result - see
 * NO_ELIGIBLE_PATIENT in ../common/error.
 *
 * `version` is `OPDSession.version`, bumped by every command. A client holding an
 * older version knows its snapshot is stale and refetches, which is how Phase 7
 * tolerates a dropped realtime event without replaying anything.
 */
export const QueueCommandResult = z.object({
  sessionId: z.string().uuid(),
  sessionStatus: SessionStatus,
  doctorPresence: DoctorPresence,
  /** Set while the queue is paused; null when running (docs/PRD.md 6.2). */
  pausedAt: z.string().datetime().nullable(),
  version: z.number().int().nonnegative(),
  entry: QueueEntryView.nullable(),
});
export type QueueCommandResult = z.infer<typeof QueueCommandResult>;

// ---------------------------------------------------------------------------
// Commands - patient movement
// ---------------------------------------------------------------------------

/**
 * POST /sessions/:id/check-in
 *
 * Exactly one identifier. `checkInCode` is the signed opaque QR reference
 * (docs/Rules.md 10) and is the primary path; `tokenNumber` is reception's manual
 * fallback when a phone is flat (docs/PRD.md 6.3). Phase 6 builds the scanner; the
 * command accepts both from Phase 4 so the fallback is never an afterthought.
 *
 * Idempotent: checking in an already-checked-in patient succeeds and changes
 * nothing, because staff double-scan and that must not be an error.
 */
export const CheckInRequest = z
  .object({
    checkInCode: z.string().min(1).max(512).optional(),
    tokenNumber: z.number().int().positive().optional(),
  })
  .refine((v) => (v.checkInCode === undefined) !== (v.tokenNumber === undefined), {
    message: 'Provide exactly one of checkInCode or tokenNumber',
  });
export type CheckInRequest = z.infer<typeof CheckInRequest>;

/**
 * POST /sessions/:id/call-next - no body. The SERVER picks who is next; a client
 * that named the patient would be deciding call order (docs/Rules.md 1).
 */
export const CallNextRequest = z.object({});
export type CallNextRequest = z.infer<typeof CallNextRequest>;

/**
 * POST /sessions/:id/start-consultation, /complete-consultation, /no-show
 *
 * The entry is named explicitly rather than inferred from "whoever is CALLED". A
 * console showing a stale patient then gets a rejection instead of silently
 * completing the wrong person - the failure mode that matters in a room with a
 * queue outside the door.
 */
export const StartConsultationRequest = EntryTarget;
export type StartConsultationRequest = z.infer<typeof StartConsultationRequest>;

export const CompleteConsultationRequest = EntryTarget;
export type CompleteConsultationRequest = z.infer<typeof CompleteConsultationRequest>;

export const NoShowRequest = EntryTarget;
export type NoShowRequest = z.infer<typeof NoShowRequest>;

/** POST /sessions/:id/skip - pass over the called patient for now (docs/PRD.md 8.8). */
export const SkipRequest = EntryTarget.extend({ reason: Reason.optional() });
export type SkipRequest = z.infer<typeof SkipRequest>;

/** POST /sessions/:id/requeue - put a skipped patient back in the eligible pool. */
export const RequeueRequest = EntryTarget;
export type RequeueRequest = z.infer<typeof RequeueRequest>;

// ---------------------------------------------------------------------------
// Commands - session control
// ---------------------------------------------------------------------------

/** POST /sessions/:id/pause - blocks call-next; joins and check-ins continue. */
export const PauseRequest = z.object({ reason: Reason.optional() });
export type PauseRequest = z.infer<typeof PauseRequest>;

export const ResumeRequest = z.object({});
export type ResumeRequest = z.infer<typeof ResumeRequest>;

/**
 * POST /sessions/:id/end
 *
 * Ends the session and resolves everyone still outstanding. Patients who were
 * present and never seen are RESCHEDULED (docs/PRD.md 8.11, doctor leaves early);
 * patients who never arrived are NO_SHOW (docs/PRD.md 8.9). Those are different
 * facts about different people, and each doc describes one of them.
 */
export const EndSessionRequest = z.object({ reason: Reason.optional() });
export type EndSessionRequest = z.infer<typeof EndSessionRequest>;

/**
 * POST /sessions/:id/presence - where the doctor physically is.
 * Independent of session status by design (docs/PRD.md 8.10).
 */
export const PresenceRequest = z.object({ presence: DoctorPresence });
export type PresenceRequest = z.infer<typeof PresenceRequest>;

// ---------------------------------------------------------------------------
// Commands - insertion
// ---------------------------------------------------------------------------

/**
 * POST /sessions/:id/walk-in
 *
 * Registers someone who turned up at reception: auto-checked-in, appended at the
 * next token number, never placed by hand (docs/PRD.md 8.6).
 *
 * `patientId` reuses an existing patient record when reception can find one;
 * otherwise `name`/`dob`/`gender` create one that belongs to no account. Exactly one
 * of the two, because a walk-in either is or is not someone already known.
 */
export const WalkInRequest = z
  .object({
    patientId: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(120).optional(),
    dob: z
      .string()
      .datetime()
      .refine((v) => new Date(v) <= new Date(), { message: 'Date of birth cannot be in the future' })
      .optional(),
    gender: Gender.optional(),
  })
  .refine((v) => (v.patientId === undefined) !== (v.name === undefined), {
    message: 'Provide either patientId or a name for a new walk-in patient',
  });
export type WalkInRequest = z.infer<typeof WalkInRequest>;

/**
 * POST /sessions/:id/priority - audited escalation (docs/PRD.md 8.7).
 *
 * The reason is REQUIRED and is written to the AuditLog. It is never shown to other
 * patients: they see only "the queue changed due to a priority case"
 * (docs/Design.md 11), with no detail about who or why.
 *
 * Setting NORMAL is how an escalation is undone, and is audited the same way.
 */
export const SetPriorityRequest = EntryTarget.extend({
  priority: QueueEntryPriority,
  reason: Reason,
});
export type SetPriorityRequest = z.infer<typeof SetPriorityRequest>;
