import Link from 'next/link';
import { Notice } from '../../components/notice';
import { btn } from '../../components/ui';

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
    <Notice
      icon="search"
      title="Page not found"
      actions={
        <Link href="/" className={btn('primary')}>
          Back to overview
        </Link>
      }
    >
      This page does not exist, or it is not part of your hospital. If you followed a bookmark, it
      may be out of date.
    </Notice>
  );
}
