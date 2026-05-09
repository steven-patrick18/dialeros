'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const STATUSES = ['paused', 'active', 'archived'] as const;
type Status = (typeof STATUSES)[number];

export function StatusToggle({
  id,
  current,
}: {
  id: string;
  current: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(current as Status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip(to: Status) {
    if (to === status) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/campaigns/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: to }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Failed (${res.status})`);
      setBusy(false);
      return;
    }
    setStatus(to);
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <div className="flex gap-2 text-sm">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy || s === status}
            onClick={() => flip(s)}
            className={
              s === status
                ? 'bg-accent text-accent-fg px-3 py-1.5 rounded uppercase text-xs'
                : 'border border-border text-fg-muted hover:bg-card-hover px-3 py-1.5 rounded uppercase text-xs disabled:opacity-50'
            }
          >
            {s}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-error text-xs mt-2">{error}</p>
      )}
    </div>
  );
}
