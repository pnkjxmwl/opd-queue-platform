import { cookies } from 'next/headers';
import type { AuthTokens } from '@opd/contracts';

/**
 * Tokens live in httpOnly cookies (docs/Rules.md 10) - never in localStorage and
 * never in a client component. Only server code can read them, so an XSS payload
 * on the page cannot exfiltrate a session.
 */
export const ACCESS_COOKIE = 'opd_at';
export const REFRESH_COOKIE = 'opd_rt';

export type CookieWriter = {
  set(name: string, value: string, options: Record<string, unknown>): void;
  delete(name: string): void;
};

export function writeSession(jar: CookieWriter, tokens: AuthTokens): void {
  const base = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
  jar.set(ACCESS_COOKIE, tokens.accessToken, { ...base, maxAge: tokens.expiresIn });
  // The refresh cookie outlives the access token - it is what survives a reload.
  jar.set(REFRESH_COOKIE, tokens.refreshToken, { ...base, maxAge: 60 * 60 * 24 * 30 });
}

export function clearSession(jar: CookieWriter): void {
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function getAccessToken(): Promise<string | undefined> {
  return (await cookies()).get(ACCESS_COOKIE)?.value;
}

export async function getRefreshToken(): Promise<string | undefined> {
  return (await cookies()).get(REFRESH_COOKIE)?.value;
}

export const apiUrl = (path: string): string =>
  `${process.env.API_URL ?? 'http://localhost:3000'}${path}`;
