'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Iter 94 — bulk-reset leads in this list whose status matches the
 * currently-filtered one, bumping them back to NEW + clearing
 * last_called_at. Only renders when the URL has ?status=<resettable>.
 *
 * Statuses that make sense to reset:
 *   CALLED_NO_ANSWER  retry no-answers
 *   BUSY              retry busies
 *   BAD_NUMBER        sweep for re-validation
 *   CALLBACK_SCHEDULED clear scheduled callbacks
 *   CONVERTED         re-engage closed leads
 *   DIALING           clear stuck-in-flight rows
 *
 * NEW + DNC are intentionally excluded — there's no "reset to NEW"
 * for a row that's already NEW, and resetting DNC would defeat the
 * compliance gate.
 */
const RESETTABLE = new Set([
  'CALLED_NO_ANSWER',
  'BUSY',
  'CALLBACK_SCHEDULED',
  'CONVERTED',
  'DNC_TEMP',
  'BAD_NUMBER',
  'DIALING',
]);

export function ResetStatusButton({
  listId,
  status,
  matchedCount,
  compact = false,
}: {
  listId: string;
  status: string;
  matchedCount: number;
  /** Iter 95 — compact mode for inline placement on the status
   * breakdown rows: smaller, just "Reset" without the count. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!RESETTABLE.has(status)) return null;

  async function reset() {
    if (
      !confirm(
        `Reset ${matchedCount.toLocaleString()} ${status} lead(s) back to NEW? This clears last_called_at so the pacer can dial them again immediately.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/lead-lists/${listId}/reset-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_status: status }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? `Failed (${res.status})`);
      return;
    }
    router.refresh();
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={reset}
        disabled={busy}
        title={`Reset ${matchedCount.toLocaleString()} ${status} → NEW`}
        className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border border-warn/40 text-warn hover:bg-warn/10 disabled:opacity-40 shrink-0"
      >
        {busy ? '…' : 'Reset'}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={reset}
        disabled={busy}
        className="text-xs px-3 py-1.5 rounded border border-warn/40 text-warn hover:bg-warn/10 disabled:opacity-40"
      >
        {busy
          ? 'Resetting…'
          : `Reset ${matchedCount.toLocaleString()} → NEW`}
      </button>
      {err && <span className="text-xs text-error">{err}</span>}
    </span>
  );
}
