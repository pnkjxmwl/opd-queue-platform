'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { Icon, type IconName } from '../../components/icon';
import { btn } from '../../components/ui';

/**
 * The console's chrome: the rail on a desktop, a bar and a drawer on anything
 * narrower.
 *
 * **The console had no responsive behaviour at all.** The shell was
 * `flex h-screen overflow-hidden` with a fixed 232px rail, so on the tablet
 * docs/Design.md 9 says reception uses, a third of the screen was navigation and the
 * queue got the rest; on a phone the board was unusable. That is not a polish
 * problem - it is the device a receptionist actually holds while walking a patient
 * to a room.
 *
 * Below `lg` the rail becomes a sticky top bar with a drawer behind a button. The
 * drawer closes on navigation and on Escape, and the links are the same links: one
 * source, two layouts, never a second component that drifts.
 *
 * **A client component for one reason: `usePathname`.** The links themselves are
 * still decided on the server from the caller's membership and passed in, so this
 * never sees a route the user is not entitled to. Hiding a link was never the
 * security boundary anyway (docs/Rules.md 10).
 */

export interface NavLink {
  href: string;
  label: string;
  icon: IconName;
}

export interface Viewer {
  email: string;
  hospitalName: string | null;
  role: string | null;
}

const isActive = (pathname: string, href: string): boolean =>
  // `/` is a prefix of every route and would otherwise light up permanently.
  href === '/' ? pathname === '/' : pathname.startsWith(href);

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary text-caption font-bold tracking-tight text-white shadow-xs"
      >
        OQ
      </span>
      <span className={'text-label font-semibold tracking-tight text-ink' + (compact ? ' sr-only sm:not-sr-only' : '')}>
        OPD Console
      </span>
    </span>
  );
}

function Links({ links, onNavigate }: { links: NavLink[]; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5" aria-label="Console">
      {links.map((link) => {
        const active = isActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={
              'group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-label transition-colors duration-100 ' +
              (active
                ? 'bg-teal-50 font-semibold text-primary'
                : 'text-ink-muted hover:bg-sunken hover:text-ink')
            }
          >
            {/*
              A 2px marker on the active item, not colour alone. Teal-on-pale-teal is
              a 2.4:1 difference against the inactive grey; the bar is what a person
              who cannot separate those two actually reads (docs/Design.md 8).
            */}
            <span
              aria-hidden="true"
              className={
                'absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-opacity ' +
                (active ? 'opacity-100' : 'opacity-0')
              }
            />
            <Icon name={link.icon} className="h-[18px] w-[18px]" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Identity({ viewer }: { viewer: Viewer }) {
  return (
    <div className="min-w-0">
      {/* The hospital and the role, together and always visible. An admin at two
          hospitals needs to know which one this action is about to change. */}
      <p className="truncate text-label font-medium text-ink" title={viewer.hospitalName ?? undefined}>
        {viewer.hospitalName ?? 'No active hospital'}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-caption text-ink-muted">
        {viewer.role !== null && (
          <span className="rounded bg-sunken px-1.5 py-px text-eyebrow uppercase text-ink-muted">
            {viewer.role}
          </span>
        )}
        <span className="truncate" title={viewer.email}>
          {viewer.email}
        </span>
      </p>
    </div>
  );
}

function SignOut({ compact = false }: { compact?: boolean }) {
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      }}
      className={btn('quiet', 'sm') + (compact ? '' : ' w-full')}
    >
      <Icon name="log-out" className="h-3.5 w-3.5" />
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}

export function ConsoleChrome({ links, viewer }: { links: NavLink[]; viewer: Viewer }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const drawerId = useId();

  // Navigating with the drawer open must not leave it open over the new page.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    // The page behind a drawer must not scroll under it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      {/* ------------------------------------------------------------------
          Desktop: the rail. Fixed, and it does not scroll with the content.
      ------------------------------------------------------------------- */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="px-4 py-4">
          <Brand />
        </div>
        <div className="border-y border-line-soft bg-canvas px-4 py-3">
          <Identity viewer={viewer} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          <Links links={links} />
        </div>
        <div className="border-t border-line-soft px-3 py-3">
          <SignOut />
        </div>
      </aside>

      {/* ------------------------------------------------------------------
          Tablet and phone: a sticky bar. The hospital name stays on it, because
          acting on the wrong hospital is the mistake this console can make that
          nothing else can undo.
      ------------------------------------------------------------------- */}
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-surface/80 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls={drawerId}
          className={btn('quiet', 'md') + ' w-9 px-0'}
        >
          <Icon name="menu" className="h-[18px] w-[18px]" title="Open navigation" />
        </button>
        <Brand compact />
        <span className="ml-auto min-w-0 truncate text-caption text-ink-muted">
          {viewer.hospitalName ?? 'No active hospital'}
        </span>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink/25 backdrop-blur-[1px]"
          />
          <div
            id={drawerId}
            className="absolute inset-y-0 left-0 flex w-[264px] max-w-[85vw] animate-fade-up flex-col border-r border-line bg-surface shadow-lg"
          >
            <div className="flex items-center justify-between px-4 py-3.5">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} className={btn('ghost', 'sm') + ' w-7 px-0'}>
                <Icon name="x" className="h-4 w-4" title="Close navigation" />
              </button>
            </div>
            <div className="border-y border-line-soft bg-canvas px-4 py-3">
              <Identity viewer={viewer} />
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-3">
              <Links links={links} onNavigate={() => setOpen(false)} />
            </div>
            <div className="border-t border-line-soft px-3 py-3">
              <SignOut />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The configuration sub-navigation, as a segmented control rather than the
 * underlined tab row it was: none of the five said which one was open.
 *
 * It scrolls horizontally below `sm` instead of wrapping into three ragged rows.
 */
export function ConfigTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <nav
      className="-mx-1 flex max-w-full gap-0.5 overflow-x-auto rounded-lg border border-line bg-canvas p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label="Configuration"
    >
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={
              'whitespace-nowrap rounded-md px-3 py-1.5 text-label transition-colors duration-100 ' +
              (active
                ? 'bg-surface font-semibold text-ink shadow-xs'
                : 'text-ink-muted hover:text-ink')
            }
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
