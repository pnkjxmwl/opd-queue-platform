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
 * `aria-busy` and the visually-hidden sentence are what a screen reader gets, since
 * pulsing grey rectangles convey nothing to one (docs/Design.md - status is never
 * conveyed by appearance alone).
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
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="h-7 w-48 animate-pulse rounded bg-canvas" />
      <div className="mt-3 h-5 w-80 animate-pulse rounded bg-canvas" />

      <div className="mt-6 rounded-lg border border-line bg-surface p-5 shadow-md">
        <div className="h-5 w-40 animate-pulse rounded bg-canvas" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex gap-3">
              <div className="h-4 w-1/4 animate-pulse rounded bg-canvas" />
              <div className="h-4 w-1/3 animate-pulse rounded bg-canvas" />
              <div className="h-4 w-1/6 animate-pulse rounded bg-canvas" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
