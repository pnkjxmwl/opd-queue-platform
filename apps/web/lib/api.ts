import { redirect } from 'next/navigation';
import type { ApiError } from '@opd/contracts';
import { apiUrl, getAccessToken } from './session';

/**
 * Server-side API call carrying the session cookie's access token.
 *
 * A 401 here means the token expired between middleware's refresh check and this
 * call, so the caller is sent back through /login rather than silently rendering
 * an empty page. Refresh itself happens in middleware, which is the only place
 * that can write cookies on a normal navigation.
 */
export async function apiGet<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(apiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });

  if (res.status === 401) redirect('/login');
  if (!res.ok) throw new Error(await describe(res));

  return res.json() as Promise<T>;
}

async function describe(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiError;
    return `${body.error.code}: ${body.error.message}`;
  } catch {
    return `Request failed with ${res.status}`;
  }
}
