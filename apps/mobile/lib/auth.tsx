import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import type { ApiError, AuthTokens } from '@opd/contracts';

/**
 * Android emulators cannot reach the host via localhost - use 10.0.2.2, or set
 * EXPO_PUBLIC_API_URL to your machine's LAN IP when testing on a physical device.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

const ACCESS_KEY = 'opd.accessToken';
const REFRESH_KEY = 'opd.refreshToken';

type AuthState = {
  ready: boolean;
  signedIn: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** fetch() against the API with the access token attached, refreshing once on 401. */
  authedFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /**
   * The current access token, for the realtime handshake (P7-MOB-01).
   *
   * Exposed here rather than re-read from SecureStore by the socket, so there is one
   * copy in memory and it is always the one `authedFetch` is using - including right
   * after a refresh, when a second reader would still be holding the old one.
   */
  accessToken: string | null;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [ready, setReady] = useState(false);

  // Tokens go in the OS keychain/keystore, never AsyncStorage (docs/Rules.md 10).
  useEffect(() => {
    void (async () => {
      const [accessToken, refreshToken] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ]);
      if (accessToken && refreshToken) setTokens({ accessToken, refreshToken, expiresIn: 0 });
      setReady(true);
    })();
  }, []);

  const persist = useCallback(async (next: AuthTokens | null) => {
    setTokens(next);
    if (next) {
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_KEY, next.accessToken),
        SecureStore.setItemAsync(REFRESH_KEY, next.refreshToken),
      ]);
    } else {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY),
        SecureStore.deleteItemAsync(REFRESH_KEY),
      ]);
    }
  }, []);

  const post = useCallback(async (path: string, body: unknown): Promise<AuthTokens> => {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => null)) as ApiError | null;
      throw new Error(err?.error.message ?? 'Something went wrong. Please try again.');
    }
    return (await res.json()) as AuthTokens;
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => persist(await post('/auth/login', { email, password })),
    [persist, post],
  );

  const signUp = useCallback(
    async (email: string, password: string, name?: string) =>
      persist(await post('/auth/signup', { email, password, ...(name ? { name } : {}) })),
    [persist, post],
  );

  const signOut = useCallback(async () => {
    if (tokens) {
      // Revoke server-side so the token family dies, not just this device's copy.
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      }).catch(() => undefined);
    }
    await persist(null);
  }, [persist, tokens]);

  const authedFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      const call = (token?: string) =>
        fetch(`${API_URL}${path}`, {
          ...init,
          headers: {
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        });

      const first = await call(tokens?.accessToken);
      if (first.status !== 401 || !tokens) return first;

      // Access token expired: rotate once, then retry. If refresh itself fails the
      // session is genuinely dead (or was revoked for reuse), so sign out.
      try {
        const refreshed = await post('/auth/refresh', { refreshToken: tokens.refreshToken });
        await persist(refreshed);
        return call(refreshed.accessToken);
      } catch {
        await persist(null);
        return first;
      }
    },
    [persist, post, tokens],
  );

  const value = useMemo<AuthState>(
    () => ({
      ready,
      signedIn: tokens !== null,
      signIn,
      signUp,
      signOut,
      authedFetch,
      accessToken: tokens?.accessToken ?? null,
    }),
    [ready, tokens, signIn, signUp, signOut, authedFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
