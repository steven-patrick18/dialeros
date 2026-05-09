'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DidManager({
  id,
  dids,
}: {
  id: string;
  dids: string[];
}) {
  const router = useRouter();
  const [newDid, setNewDid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addDid() {
    if (!newDid.trim()) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/in-groups/${id}/dids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did: newDid.trim() }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Failed (${res.status})`);
      setBusy(false);
      return;
    }
    setNewDid('');
    setBusy(false);
    router.refresh();
  }

  async function removeDid(did: string) {
    setBusy(true);
    setError(null);
    const res = await fetch(
      `/api/in-groups/${id}/dids?did=${encodeURIComponent(did)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Failed (${res.status})`);
      setBusy(false);
      return;
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={newDid}
          onChange={(e) => setNewDid(e.target.value)}
          placeholder="+14155551234"
          className="input"
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void addDid();
            }
          }}
        />
        <button
          type="button"
          onClick={addDid}
          disabled={busy || !newDid.trim()}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm whitespace-nowrap"
        >
          + Add DID
        </button>
      </div>

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-xs rounded p-2">
          {error}
        </div>
      )}

      {dids.length === 0 ? (
        <p className="text-fg-subtle text-xs">
          No DIDs attached. Add one above.
        </p>
      ) : (
        <ul className="space-y-1">
          {dids.map((d) => (
            <li
              key={d}
              className="flex items-center justify-between border border-border rounded px-3 py-2 text-sm"
            >
              <span className="font-mono">{d}</span>
              <button
                type="button"
                onClick={() => removeDid(d)}
                disabled={busy}
                className="text-error hover:text-error text-xs"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
