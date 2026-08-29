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
