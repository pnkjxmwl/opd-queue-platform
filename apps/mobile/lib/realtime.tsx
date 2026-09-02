import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENT, type SessionUpdatedEvent } from '@opd/contracts';
import { API_URL, useAuth } from './auth';
import { MY_ACTIVE_ENTRIES } from './visits';

/**
 * P7-MOB-01 · the patient's screens stop needing a poll.
 *
 * **An event invalidates a query. It never carries state into one.** docs/Rules.md 8:
 * on (re)connect the client fetches the REST snapshot and never replays events - and
 * this applies that rule to the steady state too, so there is exactly one path by
 * which a screen learns anything, whether it has been open for a second or an hour.
 * A dropped event costs a stale second; a dropped event in a delta-applying client
 * costs correctness, silently.
 *
 * The socket lives at the root and follows the session: one connection for the whole
 * app rather than one per screen, because a patient flicking between a session card
 * and their token would otherwise reconnect on every navigation.
 */

type Live = {
  connected: boolean;
  /** Watch a session while a screen is mounted. Returns a leave function. */
  watch: (sessionId: string) => () => void;
};

const RealtimeContext = createContext<Live>({ connected: false, watch: () => () => undefined });

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { accessToken, signedIn } = useAuth();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  /** Rooms this client wants to be in, so they can be re-joined after a reconnect. */
  const watched = useRef(new Set<string>());

  useEffect(() => {
    if (!signedIn || accessToken === null) {
      socketRef.current?.close();
      socketRef.current = null;
      setConnected(false);
      return;
    }

    const socket = io(API_URL, {
      auth: { token: accessToken },
      transports: ['websocket'],
      // A phone loses signal in a lift and in a hospital basement. Reconnecting is
      // the normal case here, not the exception.
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // Re-join every room, then refetch everything on screen. In that order: a
      // change that happened while the socket was down would otherwise sit on the
      // screen until the next navigation. This IS the reconnect contract.
      for (const sessionId of watched.current) {
        void socket.emitWithAck('subscribe', { sessionId });
      }
      void queryClient.invalidateQueries();
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    // Their own booking moved: called, skipped, cancelled, refunded.
    socket.on(REALTIME_EVENT.entryUpdated, () => {
      void queryClient.invalidateQueries({ queryKey: [MY_ACTIVE_ENTRIES] });
    });

    // The queue they are watching moved - including the ETA tick, which fires with
    // no change at all because time passing is the change.
    socket.on(REALTIME_EVENT.sessionUpdated, (event: SessionUpdatedEvent) => {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const key = String(query.queryKey[0] ?? '');
          return (
            key.startsWith(`/sessions/${event.sessionId}`) ||
            // The card lists carry this session's live numbers too.
            key.startsWith('/departments/') ||
            key.startsWith('/doctors/') ||
            key === MY_ACTIVE_ENTRIES
          );
        },
      });
    });

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [accessToken, signedIn, queryClient]);

  /**
   * A phone that has been in a pocket for an hour comes back with a socket that may
   * or may not still be alive, and a screen full of numbers that are certainly wrong.
   * Refetch on foreground regardless - the snapshot is the source of truth, and this
   * is the one moment a patient is definitely about to read it.
   */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void queryClient.invalidateQueries();
    });
    return () => subscription.remove();
  }, [queryClient]);

  /**
   * Stable for the life of the provider - it touches only refs.
   *
   * That matters more than it looks. Screens depend on this in a `useEffect`, so if
   * it were rebuilt whenever `connected` flipped, every watching screen would leave
   * its rooms and rejoin them on every reconnect - churn on the exact event that
   * already re-joins them, and a window in which an update is missed.
   */
  const watch = useCallback((sessionId: string) => {
    watched.current.add(sessionId);
    // A socket that is not up yet is fine: the id is in `watched`, and `connect`
    // re-joins everything there.
    void socketRef.current?.emitWithAck('subscribe', { sessionId });
    return () => {
      watched.current.delete(sessionId);
      socketRef.current?.emit('unsubscribe', { sessionId });
    };
  }, []);

  const value = useMemo<Live>(() => ({ connected, watch }), [connected, watch]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/** Watch one session's queue for as long as this screen is mounted. */
export function useLiveSession(sessionId: string | undefined): { connected: boolean } {
  const { connected, watch } = useContext(RealtimeContext);

  useEffect(() => {
    if (sessionId === undefined) return;
    return watch(sessionId);
  }, [sessionId, watch]);

  return { connected };
}

/**
 * Watch EVERY session on a list screen.
 *
 * A subscription is per session room, so a screen showing a dozen session cards was
 * subscribed to none of them: the numbers on those cards - now serving, checked in,
 * booked - sat frozen until the patient navigated away and back. The provider was
 * already invalidating these queries on `session.updated`; nothing was ever sending
 * one, because nobody had joined the rooms.
 *
 * Found by a tester on the department screen, and it applies to every list of
 * cards - a department's sessions and a doctor's.
 *
 * The ids are joined into a string for the dependency. The array is rebuilt on every
 * render by `.map()`, so depending on it directly would unsubscribe and resubscribe
 * the whole list each time - which is both a wasted round trip and a window where
 * an event is missed.
 */
export function useLiveSessions(sessionIds: readonly string[]): { connected: boolean } {
  const { connected, watch } = useContext(RealtimeContext);
  const key = sessionIds.join(',');

  useEffect(() => {
    if (key === '') return;
    const leave = key.split(',').map((sessionId) => watch(sessionId));
    return () => {
      for (const stop of leave) stop();
    };
  }, [key, watch]);

  return { connected };
}

/** Whether the app currently has a live connection, for screens that say so. */
export const useLive = (): boolean => useContext(RealtimeContext).connected;
