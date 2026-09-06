import { Icon, type IconName } from './icon';

/**
 * The shape of every "this page is not what you wanted" screen: the four error and
 * not-found boundaries, which were four hand-written variations on the same three
 * elements with three different heading sizes and two different button heights.
 *
 * Centred and narrow on purpose. These are the only screens in the console with no
 * data on them, and a left-aligned sentence stranded at the top of a 1400px page
 * reads as a rendering failure rather than as an answer.
 *
 * `digest` is the server's own reference for the failure. It is shown because it is
 * the only thing tying what a receptionist is looking at to a line in the server log
 * (P9-OBS-01) - reading six characters down a phone line is a support call that ends
 * rather than one that begins. `error.message` deliberately is NOT shown: Next
 * strips server messages in production and leaves only this, so a message here would
 * be informative in development and blank in production, which is the failure mode
 * where a screen looks finished until the one moment it matters.
 */
export function Notice({
  icon,
  title,
  children,
  actions,
  digest,
}: {
  icon: IconName;
  title: string;
  children: React.ReactNode;
  actions: React.ReactNode;
  digest?: string;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-4 grid h-11 w-11 place-items-center rounded-full bg-sunken text-ink-muted">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <h1 className="text-h1 text-ink">{title}</h1>
      <p className="mt-2 text-body-lg text-ink-muted">{children}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>
      {digest !== undefined && (
        <p className="mt-8 text-caption text-ink-muted">
          Reference <span className="font-mono tabular-nums text-ink-soft">{digest}</span>
        </p>
      )}
    </div>
  );
}
