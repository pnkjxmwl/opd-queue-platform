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
