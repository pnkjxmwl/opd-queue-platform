import type { ErrorCode } from '@opd/contracts';

/**
 * Base class for every error this API throws deliberately.
 * docs/Rules.md 7: typed errors with a stable code - never a bare string.
 *
 * Anything that is NOT an AppError is treated as an unexpected server fault by
 * the exception filter: logged in full, reported to the client as INTERNAL_ERROR.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationFailedError extends AppError {
  constructor(message = 'Request validation failed', details?: Record<string, unknown>) {
    super('VALIDATION_FAILED', 400, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Not permitted') {
    super('FORBIDDEN', 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', 404, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', details?: Record<string, unknown>) {
    super('CONFLICT', 409, message, details);
  }
}

/**
 * Cross-tenant access attempt. docs/Rules.md 1.3.
 * Deliberately reported as 403 with no detail about what was requested.
 */
export class TenantMismatchError extends AppError {
  constructor() {
    super('TENANT_MISMATCH', 403, 'Not permitted');
  }
}

/**
 * Login failure. Deliberately identical for "no such email" and "wrong password":
 * distinguishing them turns the login endpoint into an account-enumeration oracle.
 */
export class InvalidCredentialsError extends AppError {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Email or password is incorrect');
  }
}

export class EmailAlreadyRegisteredError extends AppError {
  constructor() {
    super('EMAIL_ALREADY_REGISTERED', 409, 'An account with this email already exists');
  }
}

// ---------------------------------------------------------------------------
// Queue engine (Phase 4)
// ---------------------------------------------------------------------------

/**
 * A command the state machine does not allow from the current state.
 *
 * 409, not 400: the request was well-formed and the caller was permitted - the
 * world simply moved. A doctor console that shows a stale patient gets this, and
 * the states in `details` are what let it explain itself instead of just failing.
 */
export class InvalidQueueTransitionError extends AppError {
  constructor(command: string, from: string) {
    super('INVALID_QUEUE_TRANSITION', 409, `Cannot ${command} from ${from}`, { command, from });
  }
}

/** call-next with nobody checked in. docs/PRD.md 8.2 - the doctor never idles for someone still at home. */
export class NoEligiblePatientError extends AppError {
  constructor() {
    super('NO_ELIGIBLE_PATIENT', 409, 'Nobody in this queue has checked in yet');
  }
}

/** A call-next while the queue is paused. Distinct from the above so the console can say "resume first". */
export class QueuePausedError extends AppError {
  constructor() {
    super('QUEUE_PAUSED', 409, 'The queue is paused - resume it before calling the next patient');
  }
}

/** The hospital's QueuePolicy switches this action off (walk-ins, priority). */
export class PolicyForbidsError extends AppError {
  constructor(what: string) {
    super('POLICY_FORBIDS', 409, `This hospital's queue policy does not allow ${what}`, { what });
  }
}

/** An action that requires the patient to be physically present. */
export class NotCheckedInError extends AppError {
  constructor() {
    super('NOT_CHECKED_IN', 409, 'That patient has not checked in');
  }
}

/**
 * call-next while the doctor's presence is LEFT.
 *
 * docs/PRD.md 8.11 says a doctor leaving early ends the session and reschedules the
 * rest. Staff who mark LEFT but forget to end the session would otherwise keep
 * calling patients into an empty room, so the command is refused and says which of
 * the two things to do instead.
 */
export class DoctorHasLeftError extends AppError {
  constructor() {
    super(
      'DOCTOR_HAS_LEFT',
      409,
      'The doctor is marked as having left - end the session, or set them present again',
    );
  }
}

// ---------------------------------------------------------------------------
// Join + payment (Phase 5)
// ---------------------------------------------------------------------------

/**
 * The session will not accept a join right now (docs/PRD.md 8.12).
 *
 * 409, and `details.reason` names WHICH of the four limits bit - manual close, past
 * the cutoff, the online-token cap, or the session simply being over. The patient's
 * next action is to pick another session, so an opaque "not allowed" would leave
 * them tapping the same button.
 */
export class RegistrationClosedError extends AppError {
  constructor(reason: string) {
    super('REGISTRATION_CLOSED', 409, 'This session is no longer accepting bookings', { reason });
  }
}

/**
 * This patient already holds a PAID place in this session.
 *
 * Only ever thrown for a confirmed entry. An unpaid reservation that is still live
 * is not an error at all - join returns it, so a client that lost its checkout
 * resumes rather than paying twice.
 */
export class AlreadyInQueueError extends AppError {
  constructor(entryId: string) {
    super('ALREADY_IN_QUEUE', 409, 'This patient is already booked into this session', { entryId });
  }
}
