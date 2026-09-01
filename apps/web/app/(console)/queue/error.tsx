'use client';

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
    <div className="max-w-lg">
      <h1 className="text-h1">This session isn’t available</h1>
      <p className="mt-2 text-body-lg text-ink-muted">
        It may belong to another hospital, or it may have been removed. If you followed a link or a
        bookmark, go back to the list and pick today’s session.
      </p>
      <div className="mt-6 flex gap-2">
        <a
          href="/queue"
          className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-label text-white hover:bg-teal-800"
        >
          Back to sessions
        </a>
        <button
          type="button"
          onClick={reset}
          className="h-11 rounded-md border border-line bg-surface px-4 text-label text-ink hover:bg-teal-50"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
