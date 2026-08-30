import { NextResponse, type NextRequest } from 'next/server';
import type { AuthTokens } from '@opd/contracts';
import { ACCESS_COOKIE, REFRESH_COOKIE, apiUrl, writeSession } from './lib/session';

/**
 * Route protection + silent token refresh.
 *
 * Refresh lives here because middleware is the only place that can write cookies
 * during an ordinary navigation - a server component can read them but not set
 * them. Without this, every session would hard-expire after JWT_ACCESS_TTL_SEC
 * (15 minutes) and bounce the user to /login mid-task.
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;

  if (access && !isExpiringSoon(access)) return NextResponse.next();

  // No refresh token, or refresh fails: this is a logged-out visitor.
  if (!refresh) return toLogin(req);

  const upstream = await fetch(apiUrl('/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
    cache: 'no-store',
  }).catch(() => null);

  if (!upstream?.ok) {
    const res = toLogin(req);
    // The API already revoked the family (or never knew the token); drop our copies
    // so the next request does not retry a dead token on every navigation.
    res.cookies.delete(ACCESS_COOKIE);
    res.cookies.delete(REFRESH_COOKIE);
    return res;
  }

  const res = NextResponse.next();
  writeSession(res.cookies, (await upstream.json()) as AuthTokens);
  return res;
}

function toLogin(req: NextRequest): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  // Remember where they were headed so login can send them back.
  url.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

/**
 * Reads `exp` without verifying the signature - verification is the API's job, and
 * middleware only needs to know whether it is worth refreshing. A forged token gets
 * rejected by the API on the very next call.
 */
function isExpiringSoon(token: string, skewSeconds = 60): boolean {
  try {
    const payload = token.split('.')[1];
    if (!payload) return true;
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number };
    if (!exp) return true;
    return exp * 1000 - Date.now() < skewSeconds * 1000;
  } catch {
    return true;
  }
}

export const config = {
  // Everything under (console) is protected. /login, /accept-invite, /api/auth/*
  // and static assets must stay reachable or the redirect would loop.
  //
  // /accept-invite is public by necessity: an invitee has no session yet, and the
  // token in the URL is the only thing that identifies them.
  matcher: ['/((?!login|accept-invite|api/auth|_next/static|_next/image|favicon.ico).*)'],
};
