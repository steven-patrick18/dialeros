'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ClearButton({ intentId }: { intentId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function clear() {
    if (!confirm('Clear the QA flag on this call? The call detail stays; the row leaves this queue.')) return;
    setBusy(true);
    try {
      const res = await fetch('/api/supervisor/flag-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ intent_id: intentId, clear: true }),
      });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={clear}
      disabled={busy}
      className="text-success hover:underline disabled:opacity-50"
    >
      {busy ? '…' : 'Clear'}
    </button>
  );
}
