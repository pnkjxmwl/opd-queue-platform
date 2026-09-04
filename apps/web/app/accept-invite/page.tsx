'use client';

import { useState } from 'react';
import type { ApiError } from '@opd/contracts';
import { AuthShell } from '../../components/auth-shell';
import { Banner, Field, btn, inputLg } from '../../components/ui';

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

  const mismatch = confirm !== '' && password !== confirm;

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
    <AuthShell
      title="Accept your invitation"
      intro="Choose a password to finish setting up your account."
      footer={
        <>
          If you already have an OPD Console password, it stays as it is — accepting only adds this
          hospital to your account.
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="password" label="New password" hint="At least 10 characters.">
          <input
            id="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputLg}
          />
        </Field>

        <Field id="confirm" label="Confirm password">
          <input
            id="confirm"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'confirm-mismatch' : undefined}
            className={inputLg + (mismatch ? ' border-danger' : '')}
          />
        </Field>

        {/*
          Said the moment the two stop matching, not after the form is submitted.
          The old page only told you on submit, which on a 12-character password is
          one retype too late.
        */}
        {mismatch && (
          <p id="confirm-mismatch" className="-mt-2 text-caption text-danger">
            These two do not match yet.
          </p>
        )}

        {error !== null && (
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        )}

        <button
          type="submit"
          disabled={pending || mismatch}
          className={btn('primary', 'lg') + ' mt-1 w-full'}
        >
          {pending ? 'Setting up…' : 'Set password and sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
