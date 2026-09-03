'use client';

/**
 * Covers the routes outside the console - sign-in and accepting a staff invite.
 *
 * These are the two screens reached by somebody who is NOT signed in, which changes
 * what a failure means. A receptionist inside the console can be told to go back to
 * the overview; a person stuck here has nowhere else to be, and telling them to
 * "contact your administrator" is the only honest instruction - they cannot see a
 * hospital, a queue or a support link until they are through this page.
 *
 * No `reset` button on the invite path would be wrong: the usual cause is a slow or
 * restarting API rather than a bad invite, and retrying is genuinely what fixes it.
 */
export default function AuthAreaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-h1">We couldn’t load this page</h1>
      <p className="mt-2 text-body-lg text-ink-muted">
        This is usually temporary. Try again in a moment. If it keeps happening, ask your hospital
        administrator to check that the system is running.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="h-11 rounded-md bg-primary px-4 text-label text-white hover:bg-teal-800"
        >
          Try again
        </button>
        <a
          href="/login"
          className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-label text-ink hover:bg-teal-50"
        >
          Back to sign in
        </a>
      </div>

      {error.digest !== undefined && (
        <p className="mt-6 text-caption text-ink-muted">
          Reference: <span className="font-mono tabular-nums">{error.digest}</span>
        </p>
      )}
    </main>
  );
}
