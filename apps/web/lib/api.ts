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
    /**
     * The server's request id for the failing call.
     *
     * The API stamps every response with `x-request-id` and repeats it in the error
     * envelope; until now nothing on this side read it. Without it, "the console
     * said someone acted first" cannot be matched to a server log - there is no
     * shared identifier between the two halves of one failure (P9-OBS-01).
     *
     * Not part of the message: a receptionist needs the sentence, and support needs
     * the id.
     */
    readonly requestId?: string,
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
    //
    // `details` is appended ONLY for a validation failure, where it names the field
    // that was wrong and is the whole point. Every other error puts machine context
    // there - a queue rejection carries `{command, from}` - and pasting that after a
    // sentence written for a receptionist turned "someone acted first" into
    // "(command: COMPLETE_CONSULTATION; from: COMPLETED)".
    const details =
      body.error.code === 'VALIDATION_FAILED' && body.error.details
        ? ` (${Object.entries(body.error.details)
            .map(([field, message]) => `${field}: ${String(message)}`)
            .join('; ')})`
        : '';
    const requestId =
      (body.error as { requestId?: string }).requestId ??
      res.headers.get('x-request-id') ??
      undefined;
    return new ApiCallError(body.error.code, `${body.error.message}${details}`, requestId);
  } catch {
    // Even a body we could not parse still has the header, and an unreadable 500 is
    // exactly when a request id is worth most.
    const requestId = res.headers.get('x-request-id');
    const suffix = requestId === null ? '' : ` (ref ${requestId})`;
    return new Error(`Request failed with ${res.status}${suffix}`);
  }
}
