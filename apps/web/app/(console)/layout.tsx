import type { MeResponse } from '@opd/contracts';
import { apiGet } from '../../lib/api';
import { ConsoleChrome, type NavLink } from './nav';

/**
 * Role-aware console shell. Nav is built from the caller's memberships, so a
 * RECEPTION user never sees admin links.
 *
 * This hides UI only - it is NOT the security boundary. The API authorizes every
 * request against the membership regardless of what the client renders
 * (docs/Rules.md 10).
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const me = await apiGet<MeResponse>('/me');
  const active = me.memberships.find((m) => m.status === 'ACTIVE');

  // Queue is open to all three roles: a small hospital's admin genuinely does run
  // reception, and the API has allowed ADMIN, RECEPTION and DOCTOR on every queue
  // command since Phase 4 - so hiding it from admins showed them less than they
  // were entitled to do.
  const links = (
    [
      { href: '/', label: 'Overview', icon: 'overview', roles: ['ADMIN', 'RECEPTION', 'DOCTOR'] },
      { href: '/queue', label: 'Queue', icon: 'queue', roles: ['ADMIN', 'RECEPTION', 'DOCTOR'] },
      { href: '/config', label: 'Configuration', icon: 'config', roles: ['ADMIN'] },
    ] as const
  )
    .filter((l) => active !== undefined && l.roles.includes(active.role as never))
    .map(({ href, label, icon }): NavLink => ({ href, label, icon }));

  return (
    /*
      A rail and a scrolling pane on a desktop; a bar and a scrolling page below it.

      The console is opened once and stared at for a shift, so on a monitor the
      hospital you are signed into and the way back to the queue must not leave the
      screen when a list gets long - hence `h-screen` + one scrolling child.

      Below `lg` that inverts: locking the viewport on a phone breaks the address bar
      collapse and makes the board feel stuck, so the page scrolls normally and the
      chrome is `sticky` instead. Same information, the behaviour each device
      expects.
    */
    <div className="min-h-screen bg-canvas lg:flex lg:h-screen lg:overflow-hidden">
      <ConsoleChrome
        links={links}
        viewer={{
          email: me.email,
          hospitalName: active?.hospitalName ?? null,
          role: active?.role ?? null,
        }}
      />

      <main className="min-w-0 flex-1 lg:overflow-y-auto">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          {children}
        </div>
      </main>
    </div>
  );
}
