'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DeleteGroupButton({
  id,
  name,
  inUse,
}: {
  id: string;
  name: string;
  inUse: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    if (
      !confirm(
        `Delete CID group "${name}"? All numbers inside will also be removed. This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/cid-groups/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? `Failed (${res.status})`);
      setBusy(false);
      return;
    }
    router.push('/cid-groups');
    router.refresh();
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={del}
        disabled={busy || inUse}
        title={
          inUse
            ? 'Detach this group from every route plan before deleting.'
            : undefined
        }
        className="text-sm px-4 py-2 rounded border border-error/40 text-error hover:bg-error/10 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {busy ? 'Deleting…' : 'Delete CID group'}
      </button>
      {err && <span className="text-xs text-error ml-3">{err}</span>}
    </div>
  );
}
