import Link from 'next/link';
import { requireAdminHospital } from '../../../lib/tenant';

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
 */
export default async function ConfigLayout({ children }: { children: React.ReactNode }) {
  const hospital = await requireAdminHospital();

  return (
    <>
      <h1 className="text-h1">Configuration</h1>
      <p className="mt-1 text-body text-ink-muted">{hospital.name}</p>

      <nav className="mt-5 flex flex-wrap gap-1 border-b border-line" aria-label="Configuration">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="rounded-t-md px-4 py-2.5 text-label text-ink hover:bg-teal-50"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6 flex flex-col gap-6">{children}</div>
    </>
  );
}
