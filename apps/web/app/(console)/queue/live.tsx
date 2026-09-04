'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import { REALTIME_EVENT, type SessionUpdatedEvent } from '@opd/contracts';

/**
 * P7-WEB-01 · the board stops lying about how fresh it is.
 *
 * **It renders one line of text and calls `router.refresh()`.** That is the entire
 * component, and the restraint is the point: the board is a server component that
 * already knows how to render the queue correctly, so the only thing realtime has to
 * add is a reason to render it again. Applying the event's contents to a client-side
 * copy of the queue would be the second source of truth docs/Rules.md 8 forbids -
 * and the first thing to disagree with the doctor's screen.
 *
 * `router.refresh()` re-runs the server components and patches the DOM in place, so
 * an open `<details>` menu or a half-typed reason survives the update. A reload would
 * throw both away, on a screen a receptionist is typing into.
 *
 * Everything still works with this component removed or the gateway switched off -
 * the board simply goes back to updating on navigation, which is what Phase 6
 * shipped. That is the "keep realtime additive" rule from docs/Phases.md, and this
 * file is where it would be broken if it ever is.
 */

/** Several commands can land together; one re-render answers all of them. */
const COALESCE_MS = 300;

type Status = 'connecting' | 'live' | 'offline';

export function Live({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('connecting');

  useEffect(() => {
    let socket: Socket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    // Ignore an event describing a state older than one already rendered. An equal
    // version still refreshes: the ETA tick re-broadcasts the current version
    // precisely because time passed and nothing was commanded.
    let seen = -1;

    const refresh = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), COALESCE_MS);
    };

    void (async () => {
      // The token is fetched, used for the handshake, and never stored. See
      // app/api/socket-token/route.ts for why the console holds one at all.
      const res = await fetch('/api/socket-token', { cache: 'no-store' }).catch(() => null);
      if (res === null || !res.ok || cancelled) {
        setStatus('offline');
        return;
      }
      const { token } = (await res.json()) as { token: string };
      if (cancelled) return;

      socket = io(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000', {
        auth: { token },
        transports: ['websocket'],
        withCredentials: true,
      });

      socket.on('connect', () => {
        setStatus('live');
        // Subscribe, then refresh once: anything that changed between the server
        // render and this connection would otherwise sit on screen unnoticed. This
        // is the snapshot-after-connect rule, done in the order that cannot miss.
        void socket?.emitWithAck('subscribe', { sessionId }).then((ack: { ok: boolean }) => {
          if (ack?.ok) refresh();
          else setStatus('offline');
        });
      });

      socket.on(REALTIME_EVENT.sessionUpdated, (event: SessionUpdatedEvent) => {
        if (event.sessionId !== sessionId || event.version < seen) return;
        seen = event.version;
        refresh();
      });

      socket.on('disconnect', () => setStatus('offline'));
      socket.on('connect_error', () => setStatus('offline'));
    })();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      socket?.close();
    };
  }, [router, sessionId]);

  return (
    <p
      role="status"
      className={
        'inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-caption ' +
        (status === 'live'
          ? 'border-line bg-surface text-ink-muted'
          : status === 'connecting'
            ? 'border-line bg-surface text-ink-disabled'
            : 'border-warning-line bg-warning-bg text-warning')
      }
    >
      {/*
        A dot AND a word. The dot is the thing an eye catches from a metre away and
        the word is what makes it mean something - docs/Design.md 8 forbids the dot
        on its own, and this is the indicator that decides whether a receptionist
        trusts the numbers above it.
      */}
      <span
        aria-hidden
        className={
          'h-1.5 w-1.5 rounded-full ' +
          (status === 'live'
            ? 'animate-breathe bg-success'
            : status === 'connecting'
              ? 'bg-ink-disabled'
              : 'bg-warning')
        }
      />
      {status === 'live'
        ? 'Live — this board updates itself'
        : status === 'connecting'
          ? 'Connecting for live updates…'
          : // Never silently stale. If the connection is gone the receptionist needs
            // to know the screen has stopped moving, because two staff on one stale
            // board is exactly how a patient gets called twice.
            'Not live — reload to see the latest'}
    </p>
  );
}
