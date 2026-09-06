import { requireAdminHospital } from '../../../lib/tenant';
import { ConfigTabs } from '../nav';

const TABS = [
  { href: '/config/departments', label: 'Departments' },
  { href: '/config/doctors', label: 'Doctors' },
  { href: '/config/schedules', label: 'Schedules' },
  { href: '/config/sessions', label: 'Sessions' },
  { href: '/config/policy', label: 'Queue policy' },
];

/**
 * Admin configuration shell. The membership check here hides the section; the API
 * enforces ADMIN on every one of these routes independently.
 *
 * The tabs are a client component so they can show which one is open - they all
 * rendered identically before, which meant the only way to tell where you were was
 * to read the table below them. On a narrow screen the row scrolls sideways rather
 * than wrapping into three ragged lines.
 */
export default async function ConfigLayout({ children }: { children: React.ReactNode }) {
  const hospital = await requireAdminHospital();

  return (
    <>
      <header className="mb-5">
        <p className="mb-1.5 text-eyebrow uppercase text-ink-muted">{hospital.name}</p>
        <h1 className="text-h1 text-ink">Configuration</h1>
        <p className="mt-1 max-w-[70ch] text-body text-ink-muted">
          Set up in order: departments, then the doctors in them, then when each doctor works. The
          queue policy applies to every session in this hospital.
        </p>
        <div className="mt-4">
          <ConfigTabs tabs={TABS} />
        </div>
      </header>

      <div className="flex flex-col gap-4">{children}</div>
    </>
  );
}
