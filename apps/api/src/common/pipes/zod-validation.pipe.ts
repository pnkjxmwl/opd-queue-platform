import { ArgumentMetadata, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny } from 'zod';
import { ValidationFailedError } from '../errors';

/**
 * Validates a handler argument against a shared Zod schema from @opd/contracts
 * (docs/Rules.md 6) and surfaces failures in our own error envelope.
 *
 * Usage: @Body(new ZodBody(SignupRequest)) body: SignupRequest
 */
export class ZodBody<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const parsed = this.schema.safeParse(value);
    if (parsed.success) return parsed.data;

    // Field-level detail only: never echo the submitted value back, it may be a password.
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path.join('.') || '(root)'] = issue.message;
    }
    throw new ValidationFailedError('Request validation failed', fieldErrors);
  }
}
