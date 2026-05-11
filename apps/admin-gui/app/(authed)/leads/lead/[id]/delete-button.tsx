'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DeleteLeadButton({
  leadId,
  phone,
  backHref,
}: {
  leadId: string;
  phone: string;
  backHref: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    if (
      !confirm(
        `Delete lead ${phone}? Call history is also removed (cascade). This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/leads/${leadId}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? `Failed (${res.status})`);
      setBusy(false);
      return;
    }
    router.push(backHref);
    router.refresh();
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={del}
        disabled={busy}
        className="text-sm px-4 py-2 rounded border border-error/40 text-error hover:bg-error/10 disabled:opacity-40"
      >
        {busy ? 'Deleting…' : 'Delete lead'}
      </button>
      {err && <span className="text-xs text-error ml-3">{err}</span>}
    </div>
  );
}
