'use client';

import { useState } from 'react';
import type { ApiError } from '@opd/contracts';

/**
 * Where an invited doctor or receptionist sets their password and gets a session.
 *
 * Public by necessity - the invitee has no account to authenticate with yet, and
 * the token in the URL is the only thing identifying them. It is single-use and
 * expiring, and the API refuses to say which of "unknown", "expired" or "already
 * used" applies.
 */
export default function AcceptInvitePage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    setPending(true);
    setError(null);

    // Read the token here rather than with useSearchParams(): the hook would force
    // this whole form into a Suspense boundary just to prerender it.
    const token = new URLSearchParams(window.location.search).get('token') ?? '';

    const res = await fetch('/api/auth/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });

    if (res.ok) {
      // Full navigation, not router.push: middleware must see the new cookies.
      window.location.href = '/';
      return;
    }

    const body = (await res.json().catch(() => null)) as ApiError | null;
    setError(body?.error.message ?? 'Could not accept this invitation.');
    setPending(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-h1 text-primary">Accept your invitation</h1>
      <p className="mt-2 text-body text-ink-muted">
        Choose a password to finish setting up your OPD Console account.
      </p>

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-label">New password</span>
          <input
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-sm border border-line bg-surface px-3 text-body outline-none focus:ring-2 focus:ring-accent"
          />
          <span className="text-caption text-ink-muted">At least 10 characters.</span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-label">Confirm password</span>
          <input
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-12 rounded-sm border border-line bg-surface px-3 text-body outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-sm bg-danger-bg px-3 py-2 text-body text-danger"
          >
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-sm bg-primary text-label text-white disabled:bg-ink-disabled"
        >
          {pending ? 'Setting up…' : 'Set password and sign in'}
        </button>
      </form>

      <p className="mt-6 text-caption text-ink-muted">
        If you already have an OPD Console password, it stays as it is — accepting only adds this
        hospital to your account.
      </p>
    </main>
  );
}
