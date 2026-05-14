'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function TriggerButton({ canTrigger }: { canTrigger: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function trigger() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch('/api/settings/backups/verify', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setMessage('Verification triggered — refresh in ~10s for the result.');
      // The verify script is synchronous-ish (~1s for a small DB,
      // longer for big ones); refresh after a short delay so the
      // operator sees the row land in the history.
      setTimeout(() => router.refresh(), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!canTrigger) {
    return (
      <p className="text-fg-subtle text-sm">
        Manual trigger requires the admin role.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={trigger}
        disabled={busy}
        className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
      >
        {busy ? 'Triggering…' : 'Run verify now'}
      </button>
      {message ? <p className="text-success text-sm">{message}</p> : null}
      {error ? <p className="text-error text-sm">{error}</p> : null}
    </div>
  );
}
