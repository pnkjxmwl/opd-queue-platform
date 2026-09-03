/**
 * A console URL that does not exist.
 *
 * Says nothing about WHY, on purpose. "No such department" and "that department
 * belongs to another hospital" must look identical from outside, or the 404 becomes
 * a way to enumerate which ids exist in a hospital the caller has no membership in -
 * the same reasoning that keeps the API returning 404 rather than 403 for a row it
 * will not show (docs/Rules.md 3).
 */
export default function ConsoleNotFound() {
  return (
    <div className="max-w-lg">
      <h1 className="text-h1">Page not found</h1>
      <p className="mt-2 text-body-lg text-ink-muted">
        This page does not exist, or it is not part of your hospital. If you followed a bookmark, it
        may be out of date.
      </p>
      <a
        href="/"
        className="mt-6 inline-flex h-11 items-center rounded-md bg-primary px-4 text-label text-white hover:bg-teal-800"
      >
        Back to overview
      </a>
    </div>
  );
}
