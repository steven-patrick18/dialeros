'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function HopperResetButton({
  campaignId,
  currentDepth,
}: {
  campaignId: string;
  currentDepth: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  async function reset() {
    if (
      !confirm(
        `Clear the hopper now? ${currentDepth} queued lead(s) will be removed; the pacer will rebuild it on the next tick using the current list order.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/campaigns/${campaignId}/hopper/reset`, {
      method: 'POST',
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({
        tone: 'err',
        text: j.error ?? `reset failed (${res.status})`,
      });
      return;
    }
    const j = (await res.json()) as { removed: number };
    setMsg({
      tone: 'ok',
      text: `Removed ${j.removed} queued lead(s). Pacer will refill next tick.`,
    });
    router.refresh();
  }

  return (
    <div className="flex items-center gap-3 mt-2">
      <button
        type="button"
        onClick={reset}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded border border-warn/40 text-warn hover:bg-warn/10 disabled:opacity-50"
      >
        {busy ? 'Resetting…' : 'Reset hopper'}
      </button>
      {msg && (
        <span
          className={`text-xs ${
            msg.tone === 'ok' ? 'text-success' : 'text-error'
          }`}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}
