import { redirect } from 'next/navigation';
import type { MeResponse } from '@opd/contracts';
import { apiGet } from './api';

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
export async function requireAdminHospital(): Promise<{ id: string; name: string }> {
  const me = await apiGet<MeResponse>('/me');
  const active = me.memberships.find((m) => m.status === 'ACTIVE' && m.role === 'ADMIN');
  if (!active) redirect('/');
  return { id: active.hospitalId, name: active.hospitalName };
}
