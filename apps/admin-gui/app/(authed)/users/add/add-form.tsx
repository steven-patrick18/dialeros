'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const ROLES = ['admin', 'supervisor', 'agent', 'operator'] as const;
const TIERS = ['new', 'certified', 'expert'] as const;

const ROLE_HINTS: Record<(typeof ROLES)[number], string> = {
  admin: 'Full control over cluster config and user management.',
  supervisor: 'Live floor view, listen/whisper/barge on calls. Read-only on config.',
  agent: 'Takes calls. Logs in to a campaign + chooses in-groups to receive from.',
  operator: 'API/integration role. No GUI session.',
};

export function AddUserForm({
  personas,
}: {
  personas: Array<{ id: string; name: string; enabled: number }>;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<(typeof ROLES)[number]>('agent');
  const [isAi, setIsAi] = useState(false);
  const [personaId, setPersonaId] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const body = {
      username: String(fd.get('username') ?? ''),
      email: String(fd.get('email') ?? '').trim() || undefined,
      // AI agents never log in — omit password entirely.
      password: isAi
        ? undefined
        : String(fd.get('password') ?? ''),
      role,
      display_name:
        String(fd.get('display_name') ?? '').trim() || undefined,
      skill_tier: String(fd.get('skill_tier') ?? 'new'),
      is_ai_agent: isAi,
      ai_persona_id: isAi ? personaId || null : null,
    };

    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Failed (${res.status})`);
      setSubmitting(false);
      return;
    }
    const { id } = (await res.json()) as { id: string };
    router.push(`/users/${id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <Field label="Username" hint="Lowercase alphanumeric, dashes/underscores. 3-64 chars.">
        <input name="username" required className="input" autoComplete="off" />
      </Field>

      <Field label="Display name" hint="Optional. Shown in the agent UI and supervisor floor view.">
        <input name="display_name" className="input" autoComplete="off" />
      </Field>

      <Field label="Email" hint="Optional.">
        <input name="email" type="email" className="input" autoComplete="off" />
      </Field>

      <Field
        label="Account type"
        hint="AI agent = a Worker AI driven by a persona. It never logs in; assign it to campaigns / in-groups exactly like a human.">
        <select
          value={isAi ? 'ai' : 'human'}
          onChange={(e) => setIsAi(e.target.value === 'ai')}
          className="input"
        >
          <option value="human">Human</option>
          <option value="ai">AI agent</option>
        </select>
      </Field>

      {isAi ? (
        <Field
          label="Persona"
          hint="The Worker AI persona that drives this agent (name, designation, script, voice). Manage on /settings/ai-personas.">
          <select
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            required
            className="input"
          >
            <option value="">— select a persona —</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.enabled ? '' : ' (disabled)'}
              </option>
            ))}
          </select>
        </Field>
      ) : (
      <Field label="Initial password" hint="Minimum 8 characters.">
        <input
          name="password"
          type="password"
          required
          minLength={8}
          className="input"
          autoComplete="new-password"
        />
      </Field>
      )}

      <Field label="Role" hint={ROLE_HINTS[role]}>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          className="input"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Skill tier"
        hint="Pacing engine adjusts per-agent ratio based on tier (iter 12+)."
      >
        <select name="skill_tier" defaultValue="new" className="input">
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-3">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm"
        >
          {submitting ? 'Creating…' : 'Create user'}
        </button>
        <Link
          href="/users"
          className="px-4 py-2 rounded text-sm hover:bg-card-hover text-fg-muted"
        >
          Cancel
        </Link>
      </div>
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
