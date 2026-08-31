import { z } from 'zod';

/**
 * Canonical error codes. docs/Rules.md 7 requires typed errors with a stable code, so
 * every surface (api, web, mobile) matches on the code and never on the message.
 *
 * Add codes here as phases introduce them - never invent a code inline.
 */
export const ErrorCode = z.enum([
  // generic
  'VALIDATION_FAILED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  // auth
  'INVALID_CREDENTIALS',
  'EMAIL_ALREADY_REGISTERED',
  // domain (named in docs/Rules.md 7; implemented in their phases)
  'INVALID_QUEUE_TRANSITION',
  'NOT_CHECKED_IN',
  'TENANT_MISMATCH',
  'PAYMENT_NOT_VERIFIED',
  // queue engine (Phase 4). Deliberately few: a client only needs a distinct code
  // where it shows a DIFFERENT message or offers a different action. Everything
  // else - a command against the wrong entry state, or against a session that has
  // ended - is INVALID_QUEUE_TRANSITION with the states in `details`.
  /** call-next with nobody checked in. The console says "nobody has arrived yet". */
  'NO_ELIGIBLE_PATIENT',
  /** A call-next while the queue is paused. The console says "resume first". */
  'QUEUE_PAUSED',
  /** The hospital's QueuePolicy forbids this action (walk-ins or priority off). */
  'POLICY_FORBIDS',
  /**
   * call-next while the doctor is marked as having LEFT. Distinct from QUEUE_PAUSED
   * because the fix is different: a paused queue is resumed, a departed doctor means
   * the session should be ended or the doctor marked present again.
   */
  'DOCTOR_HAS_LEFT',
  // join + payment (Phase 5)
  /**
   * The session will not accept a join right now (docs/PRD.md 8.12): closed
   * manually, past its cutoff, or at its online-token cap. Distinct from
   * INVALID_QUEUE_TRANSITION because the patient's answer is "try another session",
   * not "something went wrong" - and `details.reason` says which limit bit.
   */
  'REGISTRATION_CLOSED',
  /**
   * This patient already holds a paid place in this session. The app opens the
   * existing token instead of taking money twice.
   */
  'ALREADY_IN_QUEUE',
]);

export type ErrorCode = z.infer<typeof ErrorCode>;

/**
 * The ONLY error shape the API returns (docs/Rules.md 7).
 * Internals - stack traces, SQL, secrets - never appear here.
 */
export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});

export type ApiError = z.infer<typeof ApiError>;
