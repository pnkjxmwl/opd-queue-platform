import { NextResponse } from 'next/server';
import { LoginRequest, type ApiError, type AuthTokens } from '@opd/contracts';
import { apiUrl, writeSession } from '../../../../lib/session';

/**
 * Browser -> here -> API. This indirection exists so the tokens land in httpOnly
 * cookies set by the server; the browser never sees them (docs/Rules.md 10).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const parsed = LoginRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_FAILED', message: 'Enter a valid email and password' } },
      { status: 400 },
    );
  }

  const upstream = await fetch(apiUrl('/auth/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parsed.data),
    cache: 'no-store',
  });

  if (!upstream.ok) {
    // Pass the API's own error envelope straight through - it is already safe
    // for a client and already says nothing about whether the account exists.
    const body = (await upstream.json().catch(() => null)) as ApiError | null;
    return NextResponse.json(
      body ?? { error: { code: 'INTERNAL_ERROR', message: 'Sign-in failed' } },
      { status: upstream.status },
    );
  }

  const res = NextResponse.json({ ok: true });
  writeSession(res.cookies, (await upstream.json()) as AuthTokens);
  return res;
}
