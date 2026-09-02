import { NextResponse } from 'next/server';
import { getAccessToken } from '../../../lib/session';

/**
 * Hands the browser the access token, for the realtime handshake and nothing else.
 *
 * **This is a deliberate, narrow exception to "no token ever reaches the browser"**
 * (docs/Rules.md 10), and it is worth spelling out why it is the least-bad option.
 *
 * A WebSocket connects from the browser straight to the API, which is a different
 * origin in every deployed environment (the console is on Vercel, the API on Render).
 * Cookies set by the console are `SameSite=Lax`, so they are simply not sent there -
 * the handshake has to carry a credential of its own. The alternatives were worse:
 *
 * - **Proxy the socket through Next.** A second hop to operate, scale and debug, so
 *   that the console can avoid holding a token it can already use indirectly.
 * - **Widen the cookies to `SameSite=None`.** That weakens every request the console
 *   makes, permanently, to fix one.
 * - **Skip realtime in the console** and keep reloading. That is the phase.
 *
 * What limits the damage:
 * - it is the **access** token only, and short-lived (`JWT_ACCESS_TTL_SEC`, 15 min);
 * - the **refresh** token stays httpOnly and is never exposed, so a stolen access
 *   token expires and cannot be renewed into a lasting session;
 * - the client holds it in a local variable for one handshake and never writes it to
 *   `localStorage`, `sessionStorage` or the DOM;
 * - middleware protects this route like every other console route, and refreshes an
 *   expiring token before it is handed over.
 */
export async function GET(): Promise<NextResponse> {
  const token = await getAccessToken();
  if (token === undefined) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  // Never cached, anywhere: this is a bearer credential with a short life.
  return NextResponse.json(
    { token },
    { headers: { 'Cache-Control': 'no-store, private' } },
  );
}
