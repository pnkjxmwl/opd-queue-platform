import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

  /**
   * The same tokens, readable synchronously.
   *
   * `authedFetch` is captured by every screen's queries, and a request that has been
   * in flight for a second must not decide what to do about a 401 using the tokens
   * that were current when its closure was built. State is for rendering; this is
   * what the network path reads.
   */
  const tokensRef = useRef<AuthTokens | null>(null);

  /**
   * The rotation currently in flight, if any - the fix for a bug that signed
   * patients out roughly every fifteen minutes.
   *
   * Refresh tokens rotate and the API revokes the whole family when one is presented
   * twice, which is correct and is the entire security value of a token family. But
   * this app issues several requests at once as a matter of course - Home alone asks
   * for patients, hospitals and doctors together, and the token screen polls - so
   * when the access token expires they all get a 401 in the same instant. Before
   * this ref, each one independently posted the SAME refresh token: the first
   * rotated it, the rest were read as replay, and the family died. The patient was
   * thrown back to the sign-in screen while watching their place in a queue.
   *
   * So exactly one rotation is ever in flight, and every other 401 waits for it.
   */
  const refreshing = useRef<Promise<AuthTokens> | null>(null);

  // Tokens go in the OS keychain/keystore, never AsyncStorage (docs/Rules.md 10).
  useEffect(() => {
    void (async () => {
      const [accessToken, refreshToken] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ]);
      if (accessToken && refreshToken) {
        const restored = { accessToken, refreshToken, expiresIn: 0 };
        tokensRef.current = restored;
        setTokens(restored);
      }
      setReady(true);
    })();
  }, []);

  const persist = useCallback(async (next: AuthTokens | null) => {
    // The ref first and synchronously: a concurrent request checking whether its
    // token is already stale must see the new one immediately, not after React has
    // scheduled a render.
    tokensRef.current = next;
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
    const held = tokensRef.current;
    if (held) {
      // Revoke server-side so the token family dies, not just this device's copy.
      await fetch(`${API_URL}/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: held.refreshToken }),
      }).catch(() => undefined);
    }
    await persist(null);
  }, [persist]);

  /**
   * Rotate the refresh token - at most once at a time, however many callers ask.
   *
   * The first caller starts the rotation and every caller after it awaits the same
   * promise, so the server only ever sees one presentation of a given refresh token
   * and reuse detection stays a genuine alarm rather than something this client
   * trips over on a timer.
   *
   * A failure here means the session really is dead - expired, or revoked because
   * somebody else replayed it - so the tokens are cleared once, for everyone
   * waiting, and the throw propagates to each caller.
   */
  const refreshOnce = useCallback((): Promise<AuthTokens> => {
    if (refreshing.current !== null) return refreshing.current;

    const attempt = (async (): Promise<AuthTokens> => {
      const held = tokensRef.current;
      if (held === null) throw new Error('Signed out');

      try {
        const next = await post('/auth/refresh', { refreshToken: held.refreshToken });
        await persist(next);
        return next;
      } catch (error) {
        await persist(null);
        throw error;
      } finally {
        // Cleared as this settles, so the NEXT expiry starts a fresh rotation.
        // Callers already waiting still receive this attempt's result.
        refreshing.current = null;
      }
    })();

    refreshing.current = attempt;
    return attempt;
  }, [persist, post]);

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

      // Read at the moment of sending, not from the closure: several of these run
      // concurrently and one of them may rotate while the others are in flight.
      const sent = tokensRef.current?.accessToken;
      const first = await call(sent);
      if (first.status !== 401 || tokensRef.current === null) return first;

      // Somebody else already rotated while this request was on the wire, so the
      // token it used is simply out of date. Retry with the current one - asking for
      // another rotation here would present a refresh token that has been consumed
      // and would be read, correctly, as replay.
      const current = tokensRef.current.accessToken;
      if (current !== sent) return call(current);

      try {
        const refreshed = await refreshOnce();
        return call(refreshed.accessToken);
      } catch {
        // refreshOnce has already cleared the session; hand back the original 401 so
        // the caller surfaces the server's own message rather than inventing one.
        return first;
      }
    },
    [refreshOnce],
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
