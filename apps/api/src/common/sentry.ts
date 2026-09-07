import * as Sentry from '@sentry/node';
import { scrub } from './scrub';

/**
 * Error reporting, and the DPDP boundary it has to respect (P9-OBS-01, Phase 10).
 *
 * Phase 9 wrote and tested `scrub.ts` but deliberately installed no exporter: the
 * SDK belongs with the deployment and the India-hosting decision. This is that
 * wiring, and it is the ONLY place `scrub` is called - the rule it enforces is that
 * a patient's name never leaves the country in a stack trace, while local pino logs
 * keep full detail because they stay on infrastructure we control.
 *
 * Empty DSN is the normal state everywhere except staging and production. It is not
 * an error and must not warn on every boot: `init` is simply skipped, so nothing is
 * captured and nothing is sent.
 */
export function initSentry(dsn: string, environment: string): boolean {
  if (dsn === '') return false;

  Sentry.init({
    dsn,
    environment,
    // Errors only. Traces would sample real request payloads into the same
    // third-party service, which is the thing this file exists to prevent.
    tracesSampleRate: 0,
    sendDefaultPii: false,

    /**
     * The egress guard. Everything the SDK is about to transmit goes through the
     * scrubber first - not just the fields we thought of, the whole event.
     *
     * A throw HERE would be swallowed by the SDK and the event sent unscrubbed, so
     * failure drops the event instead. An error report is worth less than a leak.
     */
    beforeSend(event) {
      try {
        return scrub(event) as typeof event;
      } catch {
        return null;
      }
    },
  });

  return true;
}

/**
 * Report a server fault. 5xx only - a 403 or a failed validation is the API working,
 * and paging on those is how an alert channel gets muted.
 */
export function reportFault(exception: unknown, requestId?: string): void {
  Sentry.captureException(exception, requestId ? { tags: { requestId } } : undefined);
}
