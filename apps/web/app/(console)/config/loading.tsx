import { Skeleton, TableSkeleton } from '../../../components/ui';

/**
 * Shown while a configuration screen's data is being fetched on the server.
 *
 * Every page here is a server component that awaits the API before rendering
 * anything, so without this Next holds the *previous* screen on the display while
 * the next one loads. On a fast connection that is invisible; on a hospital's wifi it
 * means a receptionist clicks "Doctors", sees the departments table keep sitting
 * there, and clicks again - which is how a double submission starts.
 *
 * A skeleton rather than a spinner: it occupies the shape the content will take, so
 * the page does not jump when it arrives, and it reads as "this is loading" rather
 * than "this is broken".
 *
 * `aria-busy` and the visually-hidden sentence inside `TableSkeleton` are what a
 * screen reader gets, since pulsing grey rectangles convey nothing to one
 * (docs/Design.md 8 - status is never conveyed by appearance alone).
 *
 * **Scoped to /config deliberately, not to the whole console.** A loading file makes
 * Next STREAM the route: the shell goes out immediately, headers with it, and
 * `notFound()` can no longer set a 404 afterwards. Placed at the console root it
 * turned a cross-tenant request for another hospital's board from a 404 not-found
 * page into a 200 with a skeleton - the console walkthrough caught it in Act VIII.
 * The tenant boundary is a security property with a test behind it; a skeleton on the
 * board is a nicety, and /config is where a receptionist actually navigates between
 * slow lists anyway.
 */
export default function ConfigLoading() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-line bg-surface p-4 shadow-xs">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4 flex flex-wrap gap-3">
          <Skeleton className="h-9 flex-1" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
      <TableSkeleton rows={5} />
    </div>
  );
}
