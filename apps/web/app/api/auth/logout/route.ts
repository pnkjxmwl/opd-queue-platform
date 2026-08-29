import { NextResponse } from 'next/server';
import { apiUrl, clearSession, REFRESH_COOKIE } from '../../../../lib/session';

export async function POST(req: Request): Promise<NextResponse> {
  const refreshToken = parseCookie(req.headers.get('cookie'), REFRESH_COOKIE);

  // Revoke server-side so the token family dies, not just this browser's copy.
  if (refreshToken) {
    await fetch(apiUrl('/auth/logout'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => undefined); // clearing the cookies matters more than the round trip
  }

  const res = NextResponse.json({ ok: true });
  clearSession(res.cookies);
  return res;
}

function parseCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === name)?.[1];
}
