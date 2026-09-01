import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { ApiCallError, apiGet } from '../../../lib/api';
import { requireStaffHospital } from '../../../lib/tenant';

/**
 * The shape every queue server action shares. Same idea as `../config/_run.ts`,
 * with one difference that matters.
 *
 * **A rejection here is normal, not a fault.** There is no realtime until Phase 7,
 * so two staff members legitimately act on the same stale board and the server
 * refuses the loser - "someone already called this patient" is the system working.
 * docs/Phases.md names this as the risk of this phase: the console must surface the
 * server's own message rather than fail silently or, worse, retry. So this NEVER
 * retries, and it never invents a message of its own.
 *
 * `_` prefix keeps this out of the App Router's route table.
 */
export async function runQueueAction(
  path: string,
  work: (hospitalId: string) => Promise<string | void>,
): Promise<never> {
  // Outside the try: this can redirect, and a redirect must not be caught below.
  const hospital = await requireStaffHospital();

  let result: string | void;
  try {
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

/** Reads a required text field, trimmed. */
export function text(form: FormData, name: string): string {
  return String(form.get(name) ?? '').trim();
}

/**
 * A console read that answers "not available" instead of exploding.
 *
 * A session id in a URL is user-supplied: a stale bookmark, a link pasted between
 * two hospitals, a session that was removed. `apiGet` throws on the API's 403/404,
 * and without this the receptionist got Next's raw error page. No patient data
 * leaked - the API refuses before returning any - but a stack trace is not an answer.
 *
 * **403 and 404 collapse into the same `notFound()`, deliberately.** Distinguishing
 * "another hospital's session" from "no such session" would let anyone with a login
 * enumerate which session ids exist across the platform, which is the same reason
 * `TenantGuard` answers both with TENANT_MISMATCH server-side.
 *
 * `notFound()` renders `not-found.tsx` during the SERVER render, so it works with no
 * JavaScript and returns a real 404. An `error.tsx` boundary would only appear after
 * hydration, and would leave a bare 500 for anything that does not run scripts.
 *
 * Anything else keeps throwing. An unexpected fault must stay loud (docs/Rules.md 7).
 */
export async function queueGet<T>(path: string): Promise<T> {
  try {
    return await apiGet<T>(path);
  } catch (error) {
    if (
      error instanceof ApiCallError &&
      ['TENANT_MISMATCH', 'FORBIDDEN', 'NOT_FOUND'].includes(error.code)
    ) {
      notFound();
    }
    throw error;
  }
}
