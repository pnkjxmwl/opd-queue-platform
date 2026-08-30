import { NextResponse } from 'next/server';
import { AcceptInviteRequest, type ApiError, type AuthTokens } from '@opd/contracts';
import { apiUrl, writeSession } from '../../../../lib/session';

/**
 * Browser -> here -> API, the same indirection as /api/auth/login: accepting an
 * invitation returns a session, and those tokens must land in httpOnly cookies set
 * by the server rather than anywhere the browser can read (docs/Rules.md 10).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const parsed = AcceptInviteRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Choose a password of at least 10 characters',
        },
      },
      { status: 400 },
    );
  }

  const upstream = await fetch(apiUrl('/auth/accept-invite'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  if (!upstream.ok) {
    // The API's envelope is already safe, and already declines to say WHY an
    // invitation is invalid.
    const body = (await upstream.json().catch(() => null)) as ApiError | null;
    return NextResponse.json(
      body ?? { error: { code: 'INTERNAL_ERROR', message: 'Could not accept this invitation' } },
      { status: upstream.status },
    );
  }

  const res = NextResponse.json({ ok: true });
  writeSession(res.cookies, (await upstream.json()) as AuthTokens);
  return res;
}
