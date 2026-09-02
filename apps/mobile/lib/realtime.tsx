import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

  const value = useMemo<Live>(
    () => ({
      connected,
      watch: (sessionId: string) => {
        watched.current.add(sessionId);
        void socketRef.current?.emitWithAck('subscribe', { sessionId });
        return () => {
          watched.current.delete(sessionId);
          socketRef.current?.emit('unsubscribe', { sessionId });
        };
      },
    }),
    [connected],
  );

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

/** Whether the app currently has a live connection, for screens that say so. */
export const useLive = (): boolean => useContext(RealtimeContext).connected;
