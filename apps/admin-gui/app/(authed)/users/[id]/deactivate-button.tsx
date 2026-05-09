'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DeactivateButton({
  id,
  username,
  isSelf,
  isInactive,
}: {
  id: string;
  username: string;
  isSelf: boolean;
  isInactive: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isSelf) {
    return (
      <p className="text-fg-subtle text-xs">
        You can&apos;t deactivate your own account.
      </p>
    );
  }

  async function handleDeactivate() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Failed (${res.status})`);
      setBusy(false);
      return;
    }
    router.refresh();
    setBusy(false);
    setConfirming(false);
  }

  async function handleReactivate() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/users/${id}?action=reactivate`, {
      method: 'PATCH',
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Failed (${res.status})`);
      setBusy(false);
      return;
    }
    router.refresh();
    setBusy(false);
  }

  if (isInactive) {
    return (
      <div>
        <button
          onClick={handleReactivate}
          disabled={busy}
          className="bg-success hover:bg-success/90 disabled:opacity-50 text-accent-fg px-3 py-1.5 rounded text-sm"
        >
          {busy ? 'Reactivating…' : 'Reactivate user'}
        </button>
        {error && <p className="text-error text-xs mt-2">{error}</p>}
      </div>
    );
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-error hover:text-error text-sm"
      >
        Deactivate user
      </button>
    );
  }

  return (
    <div className="border border-error/50 bg-error/10 rounded p-4 text-sm">
      <p className="text-error mb-3">
        Deactivate <span className="font-mono">{username}</span>? They cannot
        log in until reactivated. Their open sessions are dropped immediately.
      </p>
      {error && <p className="text-error mb-3">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleDeactivate}
          disabled={busy}
          className="bg-error hover:bg-error/90 disabled:opacity-50 text-accent-fg px-3 py-1.5 rounded text-sm"
        >
          {busy ? 'Deactivating…' : 'Yes, deactivate'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="px-3 py-1.5 rounded text-sm hover:bg-card-hover text-fg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
