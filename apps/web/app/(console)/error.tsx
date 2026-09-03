'use client';

/**
 * The console's error boundary - everything under /overview and /config.
 *
 * `/queue` has its own, narrower one: down there the overwhelmingly likely cause is
 * a session that belongs to another hospital or no longer exists, so it can say
 * something specific and offer the session list. Up here the causes are genuinely
 * varied - the API restarting mid-navigation, a config row deleted in another tab,
 * a membership revoked while the page was open - and pretending to know which would
 * be worse than admitting the range.
 *
 * **`error.message` is deliberately not printed.** Next strips server messages in
 * production and leaves only a digest, so a message here would be informative in
 * development and blank in production - the failure mode where a screen looks
 * finished until the one moment it matters. The digest IS shown, because it is the
 * only thing that ties what a receptionist is looking at to a line in the server log
 * (P9-OBS-01), and reading six characters down a phone line is a support call that
 * ends rather than one that begins.
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-lg">
      <h1 className="text-h1">Something went wrong</h1>
      <p className="mt-2 text-body-lg text-ink-muted">
        This screen could not be loaded. It is usually temporary - try again, and if it keeps
        happening, use the reference below when you report it.
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
          href="/"
          className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-label text-ink hover:bg-teal-50"
        >
          Back to overview
        </a>
      </div>

      {error.digest !== undefined && (
        <p className="mt-6 text-caption text-ink-muted">
          Reference: <span className="font-mono tabular-nums">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
