'use client';

import { Notice } from '../components/notice';
import { btn } from '../components/ui';

/**
 * Covers the routes outside the console - sign-in and accepting a staff invite.
 *
 * These are the two screens reached by somebody who is NOT signed in, which changes
 * what a failure means. A receptionist inside the console can be told to go back to
 * the overview; a person stuck here has nowhere else to be, and telling them to
 * "contact your administrator" is the only honest instruction - they cannot see a
 * hospital, a queue or a support link until they are through this page.
 *
 * `reset` is offered because the usual cause is a slow or restarting API rather than
 * a bad invite, and retrying is genuinely what fixes it.
 */
export default function AuthAreaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Notice
      icon="alert-triangle"
      title="We couldn’t load this page"
      digest={error.digest}
      actions={
        <>
          <button type="button" onClick={reset} className={btn('primary')}>
            Try again
          </button>
          <a href="/login" className={btn('quiet')}>
            Back to sign in
          </a>
        </>
      }
    >
      This is usually temporary. Try again in a moment. If it keeps happening, ask your hospital
      administrator to check that the system is running.
    </Notice>
  );
}
