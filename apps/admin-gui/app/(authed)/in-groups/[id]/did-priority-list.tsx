'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Item {
  did: string;
  priority: number;
}

// Iter 179 — In-group DID list with per-row priority editor.
// Read-only display of the DID itself (managing add/remove
// happens on /dids); the priority select PATCHes the API.

export function DidPriorityList({
  inGroupId,
  items,
}: {
  inGroupId: string;
  items: Item[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function changePriority(did: string, priority: number) {
    setBusy(did);
    setError(null);
    try {
      const res = await fetch(`/api/in-groups/${inGroupId}/dids`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ did, priority }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-fg-subtle text-sm">
        No DIDs attached. Inbound calls have nowhere to land.
      </p>
    );
  }

  return (
    <div>
      {error ? (
        <p className="text-error text-xs mb-2">{error}</p>
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-fg-subtle text-xs">
            <th className="py-1.5">DID</th>
            <th className="py-1.5">Priority</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.did} className="border-t border-border">
              <td className="py-1.5 font-mono text-xs">
                <Link
                  href={`/dids/${encodeURIComponent(d.did)}`}
                  className="hover:underline"
                >
                  {d.did}
                </Link>
              </td>
              <td className="py-1.5">
                <select
                  value={d.priority}
                  onChange={(e) =>
                    void changePriority(
                      d.did,
                      Number.parseInt(e.target.value, 10),
                    )
                  }
                  disabled={busy === d.did}
                  className="border border-border rounded bg-bg px-2 py-0.5 text-xs tabular-nums"
                  aria-label={`Priority for ${d.did}`}
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
                    <option key={p} value={p}>
                      {p}
                      {p === 0 ? ' ★ highest' : ''}
                      {p === 5 ? ' (default)' : ''}
                      {p === 9 ? ' lowest' : ''}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-fg-subtle mt-2">
        Priority 0 = highest. Within the same priority band, calls
        are served oldest-first (FIFO).
      </p>
    </div>
  );
}
