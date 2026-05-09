'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SetupForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password') ?? '');
    const confirm = String(fd.get('confirm') ?? '');
    if (password !== confirm) {
      setError('Passwords do not match.');
      setSubmitting(false);
      return;
    }

    const body = {
      username: String(fd.get('username') ?? ''),
      email: String(fd.get('email') ?? ''),
      password,
    };

    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Setup failed (${res.status})`);
      setSubmitting(false);
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Username" hint="Lowercase alphanumeric, dashes/underscores. 3-64 chars.">
        <input
          name="username"
          required
          className="input"
          autoComplete="username"
          autoFocus
        />
      </Field>
      <Field label="Email" hint="Optional.">
        <input name="email" type="email" className="input" autoComplete="email" />
      </Field>
      <Field label="Password" hint="Minimum 8 characters.">
        <input
          name="password"
          type="password"
          required
          className="input"
          autoComplete="new-password"
          minLength={8}
        />
      </Field>
      <Field label="Confirm password">
        <input
          name="confirm"
          type="password"
          required
          className="input"
          autoComplete="new-password"
        />
      </Field>

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
        {submitting ? 'Creating accountâ€¦' : 'Create admin account'}
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}</div>
      {hint && <div className="text-xs text-fg-subtle mb-1">{hint}</div>}
      {children}
    </label>
  );
}
