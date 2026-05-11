'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function CidRow({
  groupId,
  numberId,
  number,
  addedAt,
}: {
  groupId: string;
  numberId: string;
  number: string;
  addedAt: string;
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
    <li className="py-2 flex items-center gap-3 text-sm">
      <span className="font-mono tabular-nums flex-1 truncate">{number}</span>
      <span className="text-xs text-fg-subtle hidden sm:block">
        {new Date(addedAt).toLocaleDateString()}
      </span>
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        className="text-xs px-2 py-1 rounded border border-border text-fg-muted hover:text-error hover:border-error/50 disabled:opacity-40"
      >
        {busy ? '…' : 'Remove'}
      </button>
      {err && <span className="text-xs text-error">{err}</span>}
    </li>
  );
}
