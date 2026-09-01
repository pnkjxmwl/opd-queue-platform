import Link from 'next/link';
import { buttonQuiet } from '../config/ui';

/**
 * What a session id that is not yours - or no longer exists - actually looks like.
 *
 * `queueGet` in `_run.ts` collapses the API's 403 and 404 into `notFound()`, so this
 * one page answers both. **Deliberately the same answer for both:** telling the
 * caller which of the two happened would let anyone with a login enumerate session
 * ids across every hospital on the platform, one request at a time - the same reason
 * `TenantGuard` refuses to distinguish them server-side.
 *
 * Rendered during the server render, so it works with JavaScript switched off and
 * returns a real 404 rather than a bare 500.
 */
export default function QueueNotFound() {
  return (
    <div className="max-w-lg">
      <h1 className="text-h1">This session isn’t available</h1>
      <p className="mt-2 text-body-lg text-ink-muted">
        It may belong to another hospital, or it may no longer exist. If you followed a bookmark or a
        link from someone else, go back and pick today’s session from the list.
      </p>
      <Link className={buttonQuiet + ' mt-6 inline-flex items-center'} href="/queue">
        Back to sessions
      </Link>
    </div>
  );
}
