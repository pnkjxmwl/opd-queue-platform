import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiCallError } from '../../../lib/api';
import { requireAdminHospital } from '../../../lib/tenant';

/**
 * The shape every config server action shares: resolve the hospital from the
 * caller's membership, do the write, then either land back on the page or come back
 * with the server's own rejection in `?error=`.
 *
 * The error is surfaced, never swallowed - docs/Rules.md 9 says the console must
 * show a server rejection rather than fail silently. Only a deliberate ApiCallError
 * is turned into a banner; anything unexpected keeps bubbling to the error boundary.
 *
 * `_` prefix keeps this out of the App Router's route table.
 */
export async function runAction(
  path: string,
  work: (hospitalId: string) => Promise<string | void>,
): Promise<never> {
  // Outside the try: this can redirect, and a redirect must not be caught below.
  const hospital = await requireAdminHospital();

  let result: string | void;
  try {
    // A returned string becomes the success query - how an action reports what it
    // did. Only ever non-secret counts; anything sensitive goes in a cookie instead.
    result = await work(hospital.id);
  } catch (error) {
    if (error instanceof ApiCallError) {
      redirect(`${path}?error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  revalidatePath(path);
  redirect(result ? `${path}?${result}` : path);
}

/**
 * Where a freshly created invitation is parked so the next render can show it.
 *
 * A cookie rather than a `?token=` redirect: a query parameter would land in browser
 * history, in the Next server log, and in any proxy log in between.
 *
 * Lives here rather than beside the action that sets it because a `'use server'`
 * module may only export async functions - exporting a plain constant from one is a
 * build error that typecheck does not catch.
 */
export const INVITE_COOKIE = 'opd_last_invite';
export const INVITE_COOKIE_TTL_SEC = 180;

/** Reads a required text field, trimmed. */
export function text(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

/** Reads an optional number field; empty means "not set", which is often null. */
export function num(form: FormData, name: string): number | null {
  const raw = text(form, name);
  return raw === '' ? null : Number(raw);
}

/** An unchecked checkbox is absent from FormData entirely. */
export function bool(form: FormData, name: string): boolean {
  return form.get(name) !== null;
}
