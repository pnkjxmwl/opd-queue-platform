import { cache } from 'react';
import { redirect } from 'next/navigation';
import type { MeResponse } from '@opd/contracts';
import { apiGet } from './api';

/**
 * The caller's account and memberships, fetched **once per request** however many
 * times it is asked for.
 *
 * Every console render used to hit `/me` two to four times: the layout fetched it to
 * build the nav, the page fetched it again through the helpers below, `/config/*`
 * added a third from its own layout, and a server action a fourth. Next normally
 * deduplicates identical `fetch` calls within one render, but `apiGet` sends
 * `cache: 'no-store'` - deliberately, because this is per-user data that must never
 * be cached across requests - and that opts out of the memoisation too.
 *
 * React's `cache()` is the right tool: it is scoped to a single request, so the
 * duplicates collapse while nothing survives into the next one. That distinction
 * matters more than the milliseconds here, because the value carries a hospital
 * membership and leaking it between users would be a tenancy bug.
 */
export const getMe = cache(async (): Promise<MeResponse> => apiGet<MeResponse>('/me'));

/**
 * The hospital the admin console acts on.
 *
 * Resolved from the caller's own memberships, never from a URL the user can edit -
 * the id then goes into the API path, where the backend resolves it again from the
 * same membership. Two independent checks, and the client's copy is never trusted
 * (docs/Rules.md 1.3).
 *
 * A non-admin is sent to the overview: this hides the UI, and the API refuses the
 * request anyway.
 */
export const requireAdminHospital = cache(async (): Promise<{ id: string; name: string }> => {
  const me = await getMe();
  const active = me.memberships.find((m) => m.status === 'ACTIVE' && m.role === 'ADMIN');
  if (!active) redirect('/');
  return { id: active.hospitalId, name: active.hospitalName };
});

/**
 * The hospital the QUEUE console acts on (Phase 6).
 *
 * Same shape as `requireAdminHospital`, widened to the three roles that may run a
 * session - and it returns the role and `doctorId`, because the console is
 * role-aware: a DOCTOR sees their own sessions, reception sees the whole hospital's.
 *
 * **This hides UI. It is not the security boundary.** Every command the board issues
 * is authorised again by the API against the same membership (docs/Rules.md 10), so
 * a doctor who edits the URL to another session gets a 403 from the server rather
 * than a screen that merely omitted the link.
 */
export const requireStaffHospital = cache(
  async (): Promise<{
    id: string;
    name: string;
    role: 'ADMIN' | 'RECEPTION' | 'DOCTOR';
    /** The Doctor record this account IS, when they are one. Null for staff. */
    doctorId: string | null;
  }> => {
    const me = await getMe();
    const active = me.memberships.find((m) => m.status === 'ACTIVE');
    if (!active) redirect('/');
    return {
      id: active.hospitalId,
      name: active.hospitalName,
      role: active.role,
      doctorId: active.doctorId,
    };
  },
);
