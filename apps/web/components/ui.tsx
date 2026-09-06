import Link from 'next/link';
import { Icon, type IconName } from './icon';

/**
 * The console's design system - every control, surface and state on every screen.
 *
 * It replaces the class strings that used to live in `app/(console)/config/ui.tsx`
 * and were, despite the name, what the queue board, the check-in desk and the
 * walk-in form were built from too. Same idea, three changes that matter:
 *
 *  1. **One definition per thing.** Six screens had six focus rings, four control
 *     heights (h-9, h-10, h-11, h-12) and two disabled treatments. A design system
 *     is not a folder, it is the absence of a second answer.
 *  2. **States are components, not paragraphs.** Empty, loading and error were a
 *     grey `<p>` wherever they appeared. Those are the states a console is IN most
 *     of the time it is not being useful, and they were the least designed thing in
 *     the product.
 *  3. **Composable sizes.** `btn()` takes a variant and a size instead of screens
 *     concatenating ` + ' w-56'` onto a frozen string.
 *
 * Server-safe: nothing here is a client component, so a server page can render the
 * whole system without shipping a byte of JavaScript.
 */

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'quiet' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const SIZE: Record<Size, string> = {
  sm: 'h-7 gap-1.5 rounded-md px-2.5 text-caption',
  md: 'h-9 gap-2 rounded-md px-3.5 text-label',
  lg: 'h-11 gap-2 rounded-md px-5 text-body-lg font-semibold',
};

/**
 * 36px by default, not 44.
 *
 * The touch-target minimum in docs/Design.md 8 is about fingers on a phone. This
 * console is a mouse on a desk, and phone-sized controls are why the configuration
 * screens fitted four rows on a monitor. Density IS the accessibility concern here -
 * a receptionist scrolling to find a patient is what actually costs someone a turn.
 *
 * `lg` exists for the two places where a target is genuinely pressed under pressure
 * and must not be missed: the board's one dominant action, and the auth forms.
 */
const VARIANT: Record<Variant, string> = {
  primary:
    'bg-primary text-white shadow-xs hover:bg-teal-800 active:bg-teal-900 ' +
    'disabled:bg-line disabled:text-ink-disabled disabled:shadow-none',
  quiet:
    'border border-line bg-surface text-ink shadow-xs hover:border-line-strong hover:bg-hover ' +
    'active:bg-sunken disabled:border-line-soft disabled:bg-surface disabled:text-ink-disabled disabled:shadow-none',
  ghost:
    'text-ink-muted hover:bg-sunken hover:text-ink active:bg-line-soft disabled:text-ink-disabled',
  danger:
    'border border-danger-line bg-surface text-danger shadow-xs hover:border-danger/40 hover:bg-danger-bg ' +
    'active:bg-danger-bg disabled:border-line disabled:text-ink-disabled disabled:shadow-none',
};

export const btn = (variant: Variant = 'primary', size: Size = 'md'): string =>
  'inline-flex select-none items-center justify-center whitespace-nowrap font-medium ' +
  'transition-colors duration-100 disabled:cursor-not-allowed ' +
  SIZE[size] +
  ' ' +
  VARIANT[variant];

/** The names the config screens already import. Same look, one definition behind them. */
export const button = btn('primary');
export const buttonQuiet = btn('quiet');
export const buttonDanger = btn('danger');

/**
 * A text control.
 *
 * `bg-surface` on a `canvas` page, so a field reads as a slot cut into the card
 * rather than a tinted rectangle laid on it - and so a disabled field, which IS
 * tinted, is distinguishable from an editable one at a glance.
 */
export const input =
  'h-9 w-full rounded-md border border-line bg-surface px-2.5 text-body text-ink shadow-xs ' +
  'transition-colors duration-100 placeholder:text-ink-disabled hover:border-line-strong ' +
  'focus:border-accent disabled:bg-sunken disabled:text-ink-muted';

/**
 * The auth forms' control size, paired with `btn(_, 'lg')`.
 *
 * A named token rather than ` + ' h-11'` at four call sites, which is how the console
 * ended up with four control heights in the first place. Sign-in and accepting an
 * invitation are pressed once, under mild stress, often on a phone - the one place in
 * this product where the desk-density argument does not apply.
 */
export const inputLg = input + ' h-11 px-3';

export const label = 'text-caption font-medium text-ink-muted';

/** A field label that sits above its control, with the gap already in it. */
export function Label({
  htmlFor,
  children,
  optional,
}: {
  htmlFor: string;
  children: React.ReactNode;
  optional?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className={label + ' mb-1 block'}>
      {children}
      {optional === true && <span className="ml-1 font-normal text-ink-disabled">optional</span>}
    </label>
  );
}

/** Label + control + optional hint, as one block that carries its own spacing. */
export function Field({
  id,
  label: text,
  hint,
  optional,
  className = '',
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  optional?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} optional={optional}>
        {text}
      </Label>
      {children}
      {hint !== undefined && <p className="mt-1 text-caption text-ink-muted">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/**
 * The page's own heading block. Every screen wrote its own, so the console had four
 * different title sizes and three ways of saying which hospital you were looking at.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        {eyebrow !== undefined && (
          <p className="mb-1.5 text-eyebrow uppercase text-ink-muted">{eyebrow}</p>
        )}
        <h1 className="text-h1 text-ink">{title}</h1>
        {description !== undefined && (
          <div className="mt-1 max-w-[70ch] text-body text-ink-muted">{description}</div>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

function CardHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-h3 text-ink">{title}</h2>
        {description !== undefined && (
          <p className="mt-0.5 text-caption text-ink-muted">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * The standard surface: a hairline, a 14px radius and the faintest possible lift.
 *
 * `tone="accent"` marks the one card on a screen that IS the screen - the board's
 * "Now with" - with a teal edge rather than a bigger shadow. On a page of nine
 * cards, shadow is not a hierarchy, it is weather.
 */
export function Card({
  title,
  description,
  actions,
  tone = 'default',
  className = '',
  children,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  tone?: 'default' | 'accent';
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={
        'rounded-lg border bg-surface shadow-xs ' +
        (tone === 'accent' ? 'border-teal-200 ring-1 ring-teal-100' : 'border-line') +
        ' ' +
        className
      }
    >
      {title !== undefined && (
        <CardHeader title={title} description={description} actions={actions} />
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** A card whose body is a table: the table draws its own edges, so no padding. */
export function TableCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
      <CardHeader title={title} description={description} actions={actions} />
      {/*
        Horizontal scroll lives HERE, on the table, not on the page. A queue with one
        long patient name used to widen the whole console and push the sidebar off a
        tablet screen.
      */}
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

/** A quiet grouping inside a card - a sub-heading that is not another box. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-eyebrow uppercase text-ink-muted">{children}</p>;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * A column head that stays put once a queue is longer than the screen - which is
 * exactly when a receptionist most needs to know which column is which.
 *
 * `bg-sunken` rather than `bg-surface`: sticky white over white rows left no edge at
 * all, so the head appeared to dissolve into the first row as it scrolled under.
 */
export const th =
  'sticky top-0 z-10 border-b border-line bg-sunken px-3 py-2 text-left text-eyebrow ' +
  'uppercase text-ink-muted first:pl-4 last:pr-4';

export const td = 'border-b border-line-soft px-3 py-2.5 text-body text-ink first:pl-4 last:pr-4';

/** A whole row, so a long table stays readable as the eye travels across it. */
export const tr = 'transition-colors duration-75 hover:bg-hover';

export const table = 'w-full border-collapse text-left';

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

const TONE: Record<'success' | 'warning' | 'danger' | 'info', { wrap: string; icon: IconName }> = {
  success: { wrap: 'border-success-line bg-success-bg text-success', icon: 'check-circle' },
  warning: { wrap: 'border-warning-line bg-warning-bg text-warning', icon: 'alert-triangle' },
  danger: { wrap: 'border-danger-line bg-danger-bg text-danger', icon: 'alert-circle' },
  info: { wrap: 'border-info-line bg-info-bg text-info', icon: 'info' },
};

/**
 * The one banner. Icon + word + sentence, never colour alone (docs/Design.md 8) -
 * which matters most at a check-in desk, where the reader is glancing between two
 * patients and a green rectangle tells them nothing.
 */
export function Banner({
  tone,
  title,
  children,
  role,
}: {
  tone: keyof typeof TONE;
  title?: string;
  children: React.ReactNode;
  role?: 'alert' | 'status';
}) {
  const { wrap, icon } = TONE[tone];
  return (
    <div
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={'flex items-start gap-2.5 rounded-md border px-3.5 py-2.5 text-body ' + wrap}
    >
      <Icon name={icon} className="mt-0.5 h-4 w-4" />
      <span className="min-w-0">
        {title !== undefined && <strong className="font-semibold">{title} </strong>}
        {children}
      </span>
    </div>
  );
}

/** Server-action failures come back as `?error=` and render here. */
export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Banner tone="danger" title="Error:" role="alert">
      {message}
    </Banner>
  );
}

export function SuccessBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Banner tone="success" role="status">
      {message}
    </Banner>
  );
}

/**
 * An empty state that says what would be here and how to make it appear.
 *
 * Every one of these was a centred grey sentence. An empty screen is the first thing
 * a new hospital sees on every page of the console, and "No departments yet" with no
 * shape and no next step reads as a product that has not finished loading.
 */
export function EmptyState({
  icon = 'inbox',
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-sunken text-ink-disabled">
        <Icon name={icon} className="h-[18px] w-[18px]" />
      </span>
      <p className="text-h3 text-ink">{title}</p>
      {children !== undefined && (
        <p className="mt-1 max-w-[46ch] text-body text-ink-muted">{children}</p>
      )}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Kept for the config screens that pass a bare sentence. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState title="Nothing here yet">{children}</EmptyState>;
}

/**
 * A loading placeholder shaped like the thing that is arriving.
 *
 * Deliberately not a spinner. A spinner says "something is happening somewhere"; a
 * block in the shape of a table says "a table is coming, and it will be this big",
 * which also means nothing jumps when the data lands.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={'animate-pulse rounded bg-sunken ' + className} />;
}

/** The shape of a roster or a config list, for a route's `loading.tsx`. */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-xs">
        <div className="border-b border-line-soft px-4 py-3">
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="divide-y divide-line-soft">
          {Array.from({ length: rows }, (_, row) => (
            <div key={row} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-4 w-56 max-w-[40%]" />
              <Skeleton className="ml-auto h-5 w-20 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data display
// ---------------------------------------------------------------------------

const BADGE = {
  neutral: 'bg-sunken text-ink-muted ring-line',
  teal: 'bg-teal-50 text-teal-800 ring-teal-200',
  success: 'bg-success-bg text-success ring-success-line',
  warning: 'bg-warning-bg text-warning ring-warning-line',
  danger: 'bg-danger-bg text-danger ring-danger-line',
  info: 'bg-info-bg text-info ring-info-line',
};

export type BadgeTone = keyof typeof BADGE;

/**
 * A status, as an icon and a word inside a ring.
 *
 * The ring is what makes a pale fill hold its shape against both `surface` and
 * `canvas`; without it the neutral badges vanished into the table head. The icon is
 * required by docs/Design.md 8 - status is never carried by colour alone - and it is
 * also simply faster to read across a room than a word is.
 */
export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: BadgeTone;
  icon?: IconName;
  children: React.ReactNode;
}) {
  return (
    <span
      className={
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-caption ' +
        'font-medium ring-1 ring-inset ' +
        BADGE[tone]
      }
    >
      {icon !== undefined && <Icon name={icon} className="h-3 w-3" />}
      {children}
    </span>
  );
}

/**
 * A token number, everywhere one appears.
 *
 * **The product's atom, and it had no component.** A token was `font-semibold
 * tabular-nums` on the board, plain text in the walk-in list and a bare `<span>` at
 * the check-in desk. It is the one string a receptionist reads aloud, matches
 * against a printed slip and types into a field, so it gets a fixed-width slab with
 * its own edge: the same width whatever the digits, and findable at a glance down a
 * column of names.
 */
export function TokenChip({
  children,
  size = 'md',
}: {
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const scale =
    size === 'lg'
      ? 'min-w-[4.5rem] px-3 py-1 text-h2'
      : size === 'sm'
        ? 'min-w-[3rem] px-1.5 py-0.5 text-caption'
        : 'min-w-[3.5rem] px-2 py-0.5 text-label';
  return (
    <span
      className={
        'inline-flex items-center justify-center rounded-md border border-line bg-sunken ' +
        'font-semibold tabular-nums tracking-tight text-ink ' +
        scale
      }
    >
      {children}
    </span>
  );
}

/** A labelled figure with its evidence under it. Used by the pace panel and overview. */
export function Stat({
  label: name,
  value,
  note,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow uppercase text-ink-muted">{name}</dt>
      <dd className="mt-1 text-h1 tabular-nums text-ink">{value}</dd>
      {note !== undefined && <p className="mt-0.5 text-caption text-ink-muted">{note}</p>}
    </div>
  );
}

/**
 * A collapsed control that opens in place.
 *
 * `<details>` rather than a modal, because the whole console works with JavaScript
 * off and a modal does not. What it gains here is a summary that looks like a
 * control instead of a 12px grey word - and a marker that turns, so it is obvious
 * the thing is openable before you have opened it.
 */
export function Disclosure({
  summary,
  tone = 'quiet',
  children,
}: {
  summary: string;
  tone?: 'quiet' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <details className="group">
      <summary
        className={
          'inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-1 ' +
          'text-caption font-medium transition-colors ' +
          (tone === 'danger'
            ? 'text-danger hover:bg-danger-bg'
            : 'text-ink-muted hover:bg-sunken hover:text-ink')
        }
      >
        <Icon
          name="chevron-right"
          className="h-3 w-3 transition-transform duration-150 group-open:rotate-90"
        />
        {summary}
      </summary>
      <div className="mt-2 animate-fade-up rounded-md border border-line bg-hover p-3">
        {children}
      </div>
    </details>
  );
}

/**
 * Offset pagination, as plain links so the page needs no client JS.
 *
 * `filters` is carried into every link: page 2 of a list filtered by date must stay
 * filtered, and dropping it silently shows the wrong rows.
 */
export function Pager({
  path,
  total,
  limit,
  offset,
  filters = {},
}: {
  path: string;
  total: number;
  limit: number;
  offset: number;
  filters?: Record<string, string | undefined>;
}) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);

  const link = (value: number) => {
    const search = new URLSearchParams();
    for (const [key, entry] of Object.entries(filters)) if (entry) search.set(key, entry);
    search.set('offset', String(Math.max(0, value)));
    return `${path}?${search.toString()}`;
  };

  return (
    <nav
      className="flex items-center justify-between gap-3 border-t border-line-soft px-4 py-2.5"
      aria-label="Pagination"
    >
      <span className="text-caption tabular-nums text-ink-muted">
        Page {page} of {pages} · {total} total
      </span>
      <span className="flex gap-2">
        {offset > 0 && (
          <Link className={btn('quiet', 'sm')} href={link(offset - limit)}>
            <Icon name="arrow-left" className="h-3 w-3" />
            Previous
          </Link>
        )}
        {offset + limit < total && (
          <Link className={btn('quiet', 'sm')} href={link(offset + limit)}>
            Next
            <Icon name="arrow-right" className="h-3 w-3" />
          </Link>
        )}
      </span>
    </nav>
  );
}
