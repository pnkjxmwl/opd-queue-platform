'use client';

import { Notice } from '../../components/notice';
import { btn } from '../../components/ui';

/**
 * The console's error boundary - everything under the overview and /config.
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
 * (P9-OBS-01).
 */
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Notice
      icon="alert-triangle"
      title="Something went wrong"
      digest={error.digest}
      actions={
        <>
          <button type="button" onClick={reset} className={btn('primary')}>
            Try again
          </button>
          <a href="/" className={btn('quiet')}>
            Back to overview
          </a>
        </>
      }
    >
      This screen could not be loaded. It is usually temporary — try again, and if it keeps
      happening, quote the reference below when you report it.
    </Notice>
  );
}
