'use client';

import { useState } from 'react';
import type { ApiError } from '@opd/contracts';
import { AuthShell } from '../../components/auth-shell';
import { Banner, Field, btn, inputLg } from '../../components/ui';

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
    <AuthShell
      title="Sign in"
      intro="Run your hospital’s OPD queue."
      footer={
        <>
          Invited by an administrator? Use the single-use link they sent you — it sets your password
          and signs you in.
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field id="email" label="Email">
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputLg}
          />
        </Field>

        <Field id="password" label="Password">
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputLg}
          />
        </Field>

        {/*
          The message the server actually gave, in the one banner the whole product
          uses. It is announced as an alert because a person who has just pressed a
          button and is looking at the button will not see a sentence appear above
          it - which is every failed sign-in on a small screen.
        */}
        {error !== null && (
          <Banner tone="danger" role="alert">
            {error}
          </Banner>
        )}

        <button type="submit" disabled={pending} className={btn('primary', 'lg') + ' mt-1 w-full'}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
