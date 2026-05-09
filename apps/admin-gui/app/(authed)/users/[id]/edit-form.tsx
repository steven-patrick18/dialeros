'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const ROLES = ['admin', 'supervisor', 'agent', 'operator'] as const;
const TIERS = ['new', 'certified', 'expert'] as const;

export function EditUserForm({
  user,
  isSelf,
}: {
  user: {
    id: string;
    username: string;
    email: string | null;
    role: string;
    display_name: string | null;
    skill_tier: string;
  };
  isSelf: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(false);

    const fd = new FormData(e.currentTarget);
    const password = String(fd.get('password') ?? '');
    const body: Record<string, unknown> = {
      email: String(fd.get('email') ?? ''),
      role: String(fd.get('role') ?? user.role),
      display_name: String(fd.get('display_name') ?? ''),
      skill_tier: String(fd.get('skill_tier') ?? user.skill_tier),
    };
    if (password.length > 0) body.password = password;

    const res = await fetch(`/api/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Failed (${res.status})`);
      setSubmitting(false);
      return;
    }
    setSuccess(true);
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Field label="Username" hint="Cannot be changed.">
        <input value={user.username} disabled className="input opacity-60" />
      </Field>

      <Field label="Display name">
        <input
          name="display_name"
          defaultValue={user.display_name ?? ''}
          className="input"
          autoComplete="off"
        />
      </Field>

      <Field label="Email">
        <input
          name="email"
          type="email"
          defaultValue={user.email ?? ''}
          className="input"
          autoComplete="off"
        />
      </Field>

      <Field
        label="Role"
        hint={
          isSelf
            ? "Heads up — changing your own role from admin can lock you out."
            : undefined
        }
      >
        <select name="role" defaultValue={user.role} className="input">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Skill tier">
        <select
          name="skill_tier"
          defaultValue={user.skill_tier}
          className="input"
        >
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="New password"
        hint="Leave blank to keep the current password. Minimum 8 characters."
      >
        <input
          name="password"
          type="password"
          minLength={8}
          className="input"
          autoComplete="new-password"
          placeholder="●●●●●●●● (unchanged)"
        />
      </Field>

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-2">
          {error}
        </div>
      )}
      {success && !error && (
        <div className="border border-success/50 bg-success/15 text-success text-sm rounded p-2">
          Saved.
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm"
      >
        {submitting ? 'Saving…' : 'Save changes'}
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
