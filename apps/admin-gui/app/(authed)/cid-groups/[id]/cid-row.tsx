'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CidRow({
  groupId,
  numberId,
  number,
  addedAt,
  usedCount,
  lastUsedAt,
}: {
  groupId: string;
  numberId: string;
  number: string;
  addedAt: string;
  /** Iter 87 — usage stats per CID. */
  usedCount: number;
  lastUsedAt: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function remove() {
    if (!confirm(`Remove ${number} from this group?`)) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(
      `/api/cid-groups/${groupId}/numbers/${numberId}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? `Failed (${res.status})`);
      setBusy(false);
      return;
    }
    router.refresh();
  }

  return (
    <tr className="border-b border-border/40">
      <td className="py-2 font-mono tabular-nums">{number}</td>
      <td className="text-right tabular-nums">
        <span
          className={
            usedCount > 0 ? 'text-success' : 'text-fg-subtle'
          }
        >
          {usedCount.toLocaleString()}
        </span>
      </td>
      <td className="text-fg-subtle text-xs">
        {lastUsedAt
          ? new Date(lastUsedAt).toLocaleString()
          : '—'}
      </td>
      <td className="text-fg-subtle text-xs hidden sm:table-cell">
        {new Date(addedAt).toLocaleDateString()}
      </td>
      <td className="text-right">
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="text-xs px-2 py-1 rounded border border-border text-fg-muted hover:text-error hover:border-error/50 disabled:opacity-40"
        >
          {busy ? '…' : 'Remove'}
        </button>
        {err && <div className="text-[10px] text-error mt-1">{err}</div>}
      </td>
    </tr>
  );
}
