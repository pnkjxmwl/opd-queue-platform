import { redirect } from 'next/navigation';
import type { ApiError } from '@opd/contracts';
import { apiUrl, getAccessToken } from './session';

/**
 * A rejection the API produced deliberately - a validation failure, a conflict, a
 * 404. Carries the message so a form can show it instead of blowing up the page.
 *
 * Anything else stays an ordinary Error and reaches the error boundary, because an
 * unexpected fault should be loud (docs/Rules.md 7).
 */
export class ApiCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiCallError';
  }
}

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
  if (!res.ok) throw await toError(res);

  return res.json() as Promise<T>;
}

/**
 * Writes. Called only from server actions, so the httpOnly cookie is readable and
 * no token ever reaches the browser.
 */
export async function apiSend<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  if (res.status === 401) redirect('/login');
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

async function toError(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as ApiError;
    // Surface the server's own message. It is written to be shown to a human and
    // deliberately carries no internals.
    const details = body.error.details
      ? ` (${Object.entries(body.error.details)
          .map(([field, message]) => `${field}: ${String(message)}`)
          .join('; ')})`
      : '';
    return new ApiCallError(body.error.code, `${body.error.message}${details}`);
  } catch {
    return new Error(`Request failed with ${res.status}`);
  }
}
