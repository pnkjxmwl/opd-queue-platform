'use client';

import { Notice } from '../../../components/notice';
import { btn } from '../../../components/ui';

/**
 * The queue console's error boundary. Covers every nested route under /queue.
 *
 * **What it is actually for:** a session that is not this caller's hospital, or one
 * that no longer exists. `apiGet` throws on a 403/404 and, without this, a
 * receptionist who followed a stale link or typed another hospital's session id got
 * Next's raw error page. No patient data leaked - the API refused before returning
 * any - but the screen was a wall of stack trace where a sentence belonged.
 *
 * It deliberately does NOT print `error.message`. Next strips server messages in
 * production and gives only a digest, so a message here would be honest in dev and
 * empty in production - and the specific reason is not the user's business anyway:
 * whether the session belongs to another hospital or does not exist, the answer is
 * the same, which is also what stops this page confirming which session ids exist.
 *
 * `reset` is offered because the other cause is transient - the API restarting, a
 * dropped connection - and retrying is genuinely the right move for those.
 */
export default function QueueError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Notice
      icon="alert-circle"
      title="This session isn’t available"
      actions={
        <>
          <a href="/queue" className={btn('primary')}>
            Back to sessions
          </a>
          <button type="button" onClick={reset} className={btn('quiet')}>
            Try again
          </button>
        </>
      }
    >
      It may belong to another hospital, or it may have been removed. If you followed a link or a
      bookmark, go back to the list and pick today’s session.
    </Notice>
  );
}
