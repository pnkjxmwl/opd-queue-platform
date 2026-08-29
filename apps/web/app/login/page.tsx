'use client';

import { useState } from 'react';
import type { ApiError } from '@opd/contracts';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (res.ok) {
      // Read ?next here rather than with useSearchParams(): the hook forces the
      // page into a Suspense boundary just to prerender a static login form.
      const next = new URLSearchParams(window.location.search).get('next');
      // Full navigation, not router.push: middleware must see the new cookies.
      window.location.href = next?.startsWith('/') ? next : '/';
      return;
    }

    const body = (await res.json().catch(() => null)) as ApiError | null;
    setError(body?.error.message ?? 'Sign-in failed. Please try again.');
    setPending(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-h1 text-primary">OPD Console</h1>
      <p className="mt-2 text-body text-ink-muted">Sign in to run your hospital&apos;s OPD queue.</p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-label">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 rounded-sm border border-line bg-surface px-3 text-body outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-label">Password</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-sm border border-line bg-surface px-3 text-body outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        {error && (
          <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-body text-danger">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-md bg-primary text-label text-white disabled:bg-slate-200 disabled:text-ink-disabled"
        >
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
