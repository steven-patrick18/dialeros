'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const STRATEGIES = ['rotate', 'random', 'sticky_by_area'] as const;
type Strategy = (typeof STRATEGIES)[number];

const STRATEGY_HINTS: Record<Strategy, string> = {
  rotate:
    'Round-robin through the group. Pacer picks the next number on every call.',
  random: 'Pick a random number from the group on every call.',
  sticky_by_area:
    'Prefer a number whose area code matches the lead. Falls back to round-robin if no match.',
};

export function AddCidGroupForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('rotate');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? '').trim() || undefined,
      strategy,
    };

    const res = await fetch('/api/cid-groups', {
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
    router.push(`/cid-groups/${id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-5">
      <Section title="Identity">
        <Field
          label="Name"
          hint="Alphanumeric, dashes, underscores. Shown in the route-plan picker."
        >
          <input
            name="name"
            required
            className="input"
            placeholder="us-local-presence"
            autoComplete="off"
          />
        </Field>
        <Field label="Description" hint="Optional.">
          <input
            name="description"
            className="input"
            placeholder="Local-presence DIDs for US outbound"
            autoComplete="off"
          />
        </Field>
      </Section>

      <Section title="Per-call logic">
        <Field label="Strategy" hint={STRATEGY_HINTS[strategy]}>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value as Strategy)}
            className="input"
          >
            {STRATEGIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-3">
          {error}
        </div>
      )}

      <div className="pt-2 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm"
        >
          {submitting ? 'Saving…' : 'Add CID group'}
        </button>
        <Link
          href="/cid-groups"
          className="px-4 py-2 rounded text-sm hover:bg-card-hover text-fg-muted"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted">{title}</h2>
      {children}
    </div>
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
