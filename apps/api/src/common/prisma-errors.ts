import { Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from './errors';

/**
 * Map Prisma's constraint failures onto our error envelope, once, where every
 * caller routes through.
 *
 * docs/Rules.md 5 prefers database constraints over application checks, which
 * means the database - not the service - is what rejects a duplicate. Left
 * unmapped that surfaces as a 500 with Prisma internals in it, breaking both the
 * status-code rule (409 for a conflict) and the "never leak internals" rule.
 *
 * P2002 = unique constraint, P2025 = record required but not found.
 */
export async function mapPrismaErrors<T>(
  work: () => Promise<T>,
  messages: { conflict?: string; notFound?: string } = {},
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictError(messages.conflict ?? 'Already exists');
      }
      if (error.code === 'P2025') {
        throw new NotFoundError(messages.notFound ?? 'Not found');
      }
    }
    throw error;
  }
}

/** True when the failure was a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
