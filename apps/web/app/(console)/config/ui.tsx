import Link from 'next/link';

/**
 * The handful of class strings the five config screens share.
 *
 * Deliberately constants and two tiny components rather than a component library:
 * these are onboarding forms an admin uses a few times, and docs/Phases.md warns
 * that this is exactly where scope creep starts. Tokens come from
 * docs/Design.md via tailwind.config.ts - nothing here invents a colour.
 */
export const input =
  'h-11 w-full rounded-md border border-line bg-surface px-3 text-body text-ink ' +
  'placeholder:text-ink-disabled focus:border-primary focus:outline-none focus:ring-2 focus:ring-teal-200';

export const label = 'text-caption text-ink-muted';

// >= 44px tall: docs/Design.md touch-target minimum, which applies to the console too.
export const button =
  'h-11 rounded-md bg-primary px-4 text-label text-white hover:bg-teal-800 ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-300 disabled:bg-ink-disabled';

export const buttonQuiet =
  'h-11 rounded-md border border-line bg-surface px-4 text-label text-ink hover:bg-teal-50 ' +
  'focus:outline-none focus:ring-2 focus:ring-teal-200';

export const buttonDanger =
  'h-11 rounded-md border border-danger px-3 text-label text-danger hover:bg-danger-bg ' +
  'focus:outline-none focus:ring-2 focus:ring-danger';

export const th = 'px-3 py-2 text-left text-caption uppercase tracking-wide text-ink-muted';
export const td = 'px-3 py-2 text-body text-ink align-middle';

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-h3">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Server-action failures come back as a `?error=` query param and render here.
 *
 * Not colour alone (docs/Design.md): the word "Error" and an icon carry the meaning
 * for anyone who cannot distinguish the red.
 */
export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-4 flex items-start gap-2 rounded-md bg-danger-bg px-3 py-2 text-body text-danger"
    >
      <span aria-hidden="true">⚠</span>
      <span>
        <strong className="font-semibold">Error:</strong> {message}
      </span>
    </p>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-body text-ink-muted">{children}</p>;
}

/**
 * Offset pagination, rendered as plain links so the page needs no client JS.
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
    <nav className="mt-4 flex items-center justify-between text-body" aria-label="Pagination">
      <span className="text-ink-muted tabular-nums">
        Page {page} of {pages} · {total} total
      </span>
      <span className="flex gap-2">
        {offset > 0 && (
          <Link className={buttonQuiet + ' inline-flex items-center'} href={link(offset - limit)}>
            Previous
          </Link>
        )}
        {offset + limit < total && (
          <Link className={buttonQuiet + ' inline-flex items-center'} href={link(offset + limit)}>
            Next
          </Link>
        )}
      </span>
    </nav>
  );
}
