'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Iter 179 — priority editor for DIDs. The legacy `dids: string[]`
// prop is kept for back-compat; new `didsWithPriority` carries
// the priority band (0..9, 0=highest) for the editor.
interface DidWithPriority {
  did: string;
  priority: number;
}

export function DidManager({
  id,
  dids,
  didsWithPriority,
}: {
  id: string;
  dids: string[];
  didsWithPriority?: DidWithPriority[];
}) {
  const router = useRouter();
  const [newDid, setNewDid] = useState('');
  const [busy, setBusy] = useState(false);
  // Iter 179 — saving state for priority changes (per-DID).
  const [priorityBusy, setPriorityBusy] = useState<string | null>(null);

  // Iter 179 — Save a new priority for a DID.
  async function changePriority(did: string, priority: number) {
    setPriorityBusy(did);
    setError(null);
    try {
      const res = await fetch(`/api/in-groups/${id}/dids`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ did, priority }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(err.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setPriorityBusy(null);
    }
  }
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
          {didsWithPriority ? (
          didsWithPriority.map((d) => (
            <li
              key={d.did}
              className="flex items-center justify-between gap-3 py-1"
            >
              <span className="font-mono text-sm">{d.did}</span>
              <div className="flex items-center gap-3">
                <label className="text-xs text-fg-subtle flex items-center gap-1">
                  pri:
                  <select
                    value={d.priority}
                    onChange={(e) =>
                      void changePriority(
                        d.did,
                        Number.parseInt(e.target.value, 10),
                      )
                    }
                    disabled={priorityBusy === d.did}
                    className="border border-border rounded bg-bg px-1 py-0.5 text-xs"
                  >
                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
                      <option key={p} value={p}>
                        {p}
                        {p === 0 ? ' ★' : ''}
                        {p === 5 ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void removeDid(d.did)}
                  disabled={busy}
                  className="text-error hover:underline text-xs"
                >
                  Remove
                </button>
              </div>
            </li>
          ))
        ) : (
          dids.map((d) => (
            <li
              key={d}
              className="flex items-center justify-between"
            >
              <span className="font-mono text-sm">{d}</span>
              <button
                type="button"
                onClick={() => void removeDid(d)}
                disabled={busy}
                className="text-error hover:underline text-xs"
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>
      )}
    </div>
  );
}
