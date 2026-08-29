import Link from 'next/link';
import type { MeResponse } from '@opd/contracts';
import { apiGet } from '../../lib/api';
import { LogoutButton } from './logout-button';

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

  const links = [
    { href: '/', label: 'Overview', roles: ['ADMIN', 'RECEPTION', 'DOCTOR'] },
    { href: '/queue', label: 'Queue', roles: ['RECEPTION', 'DOCTOR'] },
    { href: '/config', label: 'Configuration', roles: ['ADMIN'] },
  ].filter((l) => active && l.roles.includes(active.role));

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 flex-col border-r border-line bg-surface p-5">
        <span className="text-h3 text-primary">OPD Console</span>
        <span className="mt-1 text-caption text-ink-muted">
          {active ? `${active.hospitalName} · ${active.role}` : 'No active hospital'}
        </span>

        <nav className="mt-6 flex flex-col gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md px-3 py-2 text-label text-ink hover:bg-teal-50"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2 pt-6">
          <span className="truncate text-caption text-ink-muted">{me.email}</span>
          <LogoutButton />
        </div>
      </aside>

      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
