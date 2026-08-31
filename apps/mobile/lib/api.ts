import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiError } from '@opd/contracts';
import { useAuth } from './auth';

/**
 * A GET against the API, with the access token attached and errors turned into
 * something a patient can read.
 *
 * The path IS the cache key, so two screens asking for the same URL share one
 * fetch and one cache entry - including the query string, which is what varies.
 *
 * docs/Rules.md 9: server state lives in TanStack Query, never in component state.
 *
 * `refetchMs` polls while the screen is mounted. Opt-in per screen, and only worth
 * it where the answer actually changes on its own - a live queue does, a hospital's
 * address does not. Polling every list would multiply load on a read path that has
 * no caching yet (deliberate; docs/Phases.md Phase 9).
 *
 * This is NOT a substitute for Phase 7's realtime, and Phase 7 does not have to undo
 * it: docs/Rules.md 8 already requires clients to reconcile against a REST snapshot
 * rather than replay events, so this is that path, running on a timer until there is
 * a socket to trigger it instead.
 */
export function useApi<T>(path: string, enabled = true, refetchMs?: number) {
  const { authedFetch } = useAuth();

  return useQuery({
    queryKey: [path],
    enabled,
    refetchInterval: refetchMs,
    // Default is false, but state it: a phone in someone's pocket must not poll a
    // hospital API every few seconds for a screen nobody is looking at.
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<T> => {
      let res: Response;
      try {
        res = await authedFetch(path);
      } catch {
        // fetch() rejects only on a transport failure, which on a phone almost
        // always means no signal. Saying so beats "Network request failed".
        throw new Error('You appear to be offline. Check your connection and try again.');
      }

      if (!res.ok) {
        // The API's envelope is written to be shown to a human and carries no
        // internals (docs/Rules.md 7).
        const body = (await res.json().catch(() => null)) as ApiError | null;
        throw new Error(body?.error.message ?? 'Something went wrong. Please try again.');
      }

      return res.json() as Promise<T>;
    },
  });
}

/**
 * A write. Returns a TanStack mutation, so a screen gets `isPending` and `error`
 * without inventing its own loading state (docs/Rules.md 9).
 *
 * Errors carry the server's message, which is written to be shown to a patient and
 * contains no internals. A rejected command must be SURFACED, never swallowed - the
 * server is the only thing that decides whether a join or a cancel is allowed, and
 * a screen that silently ignores its answer is the failure docs/CLAUDE.md 9 names.
 */
export function useApiPost<TBody, TResult>(path: string) {
  const { authedFetch } = useAuth();

  return useMutation<TResult, Error, TBody>({
    mutationFn: async (body: TBody): Promise<TResult> => {
      let res: Response;
      try {
        res = await authedFetch(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
      } catch {
        throw new Error('You appear to be offline. Check your connection and try again.');
      }

      if (!res.ok) {
        const parsed = (await res.json().catch(() => null)) as ApiError | null;
        const error = new Error(parsed?.error.message ?? 'Something went wrong. Please try again.');
        // The CODE is what a screen should branch on, never the message
        // (docs/Rules.md 7). Attached rather than parsed again at each call site.
        (error as Error & { code?: string }).code = parsed?.error.code;
        throw error;
      }

      return res.json() as Promise<TResult>;
    },
  });
}
