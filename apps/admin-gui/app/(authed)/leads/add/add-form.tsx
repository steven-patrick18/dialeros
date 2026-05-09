'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AddLeadListForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const body = {
      name: String(fd.get('name') ?? ''),
      description: String(fd.get('description') ?? '').trim() || undefined,
    };
    const res = await fetch('/api/lead-lists', {
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
    router.push(`/leads/${id}`);
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <label className="block">
        <div className="text-sm font-medium mb-1">Name</div>
        <div className="text-xs text-fg-subtle mb-1">
          Alphanumeric, dashes, underscores. 1-64 chars.
        </div>
        <input
          name="name"
          required
          className="input"
          placeholder="sales-usa-2026q1"
          autoComplete="off"
          autoFocus
        />
      </label>

      <label className="block">
        <div className="text-sm font-medium mb-1">Description</div>
        <div className="text-xs text-fg-subtle mb-1">Optional.</div>
        <input
          name="description"
          className="input"
          placeholder="US outbound, cold leads from Q4 webinar"
          autoComplete="off"
        />
      </label>

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
          {submitting ? 'Creating…' : 'Create list'}
        </button>
        <Link
          href="/leads"
          className="px-4 py-2 rounded text-sm hover:bg-card-hover text-fg-muted"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
