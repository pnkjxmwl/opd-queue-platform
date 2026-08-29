'use client';

export function LogoutButton() {
  return (
    <button
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login';
      }}
      className="rounded-md border border-line px-3 py-2 text-label text-ink hover:bg-slate-50"
    >
      Sign out
    </button>
  );
}
