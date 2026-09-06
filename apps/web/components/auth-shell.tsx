import { Icon, type IconName } from './icon';

/**
 * The frame around the two screens reached before anyone is signed in: sign-in, and
 * accepting a staff invitation.
 *
 * **They looked like two different products.** Sign-in was a card with 40px controls
 * and a teal focus ring; the invite page was bare type on white with 48px controls,
 * 6px radii and a different ring. Both are the first screen a new hospital's staff
 * ever see, and the first thing that makes software feel unfinished is a front door
 * that does not match the room behind it.
 *
 * The left panel is not decoration and it is not a testimonial: it says, in the
 * product's own words, what the thing on the right is for. Below `lg` it collapses
 * to the brand mark alone, because on a phone the form is the entire job.
 *
 * Deliberately no illustration and no gradient (docs/Design.md 2.5). The panel is
 * the pale canvas with a hairline against the white form - the same two surfaces the
 * console itself is built from, so signing in is visibly the same product.
 */

const POINTS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'activity',
    title: 'One live board',
    body: 'Call, start and complete consultations. Every action is ordered by the server, never by the screen.',
  },
  {
    icon: 'camera',
    title: 'Check in three ways',
    body: 'Scan the token QR, type the number, or find the patient in the list. None of them needs the others.',
  },
  {
    icon: 'clock',
    title: 'Honest waiting times',
    body: 'Patients are given a window based on how fast this doctor is actually running today.',
  },
];

export function AuthShell({
  title,
  intro,
  children,
  footer,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
      {/* ------------------------------------------------------------------
          The panel. Hidden below `lg` - on a phone it would be three screens
          of scrolling in front of a password field.
      ------------------------------------------------------------------- */}
      <aside className="hidden flex-col justify-between border-r border-line px-12 py-12 lg:flex">
        <Brand />

        <div className="max-w-lg">
          <h2 className="text-h1 text-ink">
            The queue is the product.
            <br />
            Everything else supports it.
          </h2>
          <dl className="mt-8 flex flex-col gap-6">
            {POINTS.map((point) => (
              <div key={point.title} className="flex gap-3.5">
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border border-line bg-surface text-primary shadow-xs">
                  <Icon name={point.icon} className="h-4 w-4" />
                </span>
                <div>
                  <dt className="text-label font-semibold text-ink">{point.title}</dt>
                  <dd className="mt-0.5 max-w-[46ch] text-body text-ink-muted">{point.body}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-caption text-ink-muted">
          Patient data is treated as sensitive. Access is logged.
        </p>
      </aside>

      {/* ------------------------------------------------------------------
          The form. White, so it reads as the surface being acted on.
      ------------------------------------------------------------------- */}
      <main className="flex min-h-screen flex-col justify-center border-line bg-surface px-6 py-12 sm:px-10 lg:border-l">
        <div className="mx-auto w-full max-w-[380px]">
          <div className="lg:hidden">
            <Brand />
          </div>

          <h1 className="mt-8 text-h1 text-ink lg:mt-0">{title}</h1>
          <p className="mt-1.5 text-body text-ink-muted">{intro}</p>

          <div className="mt-7">{children}</div>

          {footer !== undefined && (
            <div className="mt-6 border-t border-line-soft pt-5 text-caption text-ink-muted">
              {footer}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="grid h-8 w-8 place-items-center rounded-md bg-primary text-caption font-bold tracking-tight text-white shadow-xs"
      >
        OQ
      </span>
      <span className="text-h3 tracking-tight text-ink">OPD Console</span>
    </span>
  );
}
