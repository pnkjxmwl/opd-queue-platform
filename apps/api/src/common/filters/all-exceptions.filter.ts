import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError } from '@opd/contracts';
import { AppError } from '../errors';
import { reportFault } from '../sentry';

/**
 * The single place an error becomes an HTTP response (docs/Rules.md 7).
 *
 * Guarantees:
 *   - one response shape, always: { error: { code, message, details?, requestId? } }
 *   - internals (stack, SQL, secrets) are logged server-side and NEVER sent to a client
 *   - unexpected faults are logged at error level with the full exception
 *
 * Uses the standard Nest Logger rather than injecting nestjs-pino's PinoLogger:
 * PinoLogger is transient-scoped and awkward to inject here, and main.ts already
 * routes the global logger into pino via app.useLogger().
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id;

    const { status, body } = this.toResponse(exception, requestId);
    const where = `${req.method} ${req.url}${requestId ? ` [${requestId}]` : ''}`;

    if (status >= 500) {
      this.logger.error(
        `Unhandled server error: ${where}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      // 5xx only, and scrubbed on the way out (common/sentry.ts). A no-op until a
      // DSN is configured, which is every environment but staging and production.
      reportFault(exception, requestId);
    } else {
      this.logger.warn(`${body.error.code}: ${where} - ${body.error.message}`);
    }

    res.status(status).json(body);
  }

  private toResponse(exception: unknown, requestId?: string): { status: number; body: ApiError } {
    const withId = requestId ? { requestId } : {};

    if (exception instanceof AppError) {
      return {
        status: exception.httpStatus,
        body: {
          error: {
            code: exception.code,
            message: exception.message,
            ...(exception.details ? { details: exception.details } : {}),
            ...withId,
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        body: {
          error: {
            code:
              status === 404
                ? 'NOT_FOUND'
                : // ThrottlerGuard throws a plain HttpException, so without this a
                  // rate-limited caller is told their REQUEST was invalid and will
                  // "fix" it and retry - the opposite of what 429 asks for.
                  status === 429
                  ? 'RATE_LIMITED'
                  : status < 500
                    ? 'VALIDATION_FAILED'
                    : 'INTERNAL_ERROR',
            message:
              status === 429 ? 'Too many requests. Please wait and try again.' : exception.message,
            ...withId,
          },
        },
      };
    }

    // Unknown: say nothing useful to the client, log everything server-side.
    return {
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', ...withId } },
    };
  }
}
