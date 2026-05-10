'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const body = {
      username: String(fd.get('username') ?? ''),
      password: String(fd.get('password') ?? ''),
    };

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Login failed (${res.status})`);
      setSubmitting(false);
      return;
    }

    const data = (await res.json().catch(() => ({}))) as {
      user?: { role?: string };
    };
    const dest = data.user?.role === 'agent' ? '/agent' : '/';
    router.push(dest);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block">
        <div className="text-sm font-medium mb-1">Username</div>
        <input
          name="username"
          required
          className="input"
          autoComplete="username"
          autoFocus
        />
      </label>
      <label className="block">
        <div className="text-sm font-medium mb-1">Password</div>
        <input
          name="password"
          type="password"
          required
          className="input"
          autoComplete="current-password"
        />
      </label>

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-3">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm"
      >
        {submitting ? 'Signing inâ€¦' : 'Sign in'}
      </button>
    </form>
  );
}
