'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DeleteRemoteAgentButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    if (!confirm(`Delete remote agent "${name}"? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/remote-agents/${id}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `Failed (${res.status})`);
      return;
    }
    router.push('/remote-agents');
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded border border-error/40 text-error hover:bg-error/10"
      >
        {busy ? 'Deleting…' : 'Delete remote agent'}
      </button>
      {error && (
        <div className="mt-2 text-error text-xs">{error}</div>
      )}
    </div>
  );
}
