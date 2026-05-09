'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function DeleteInGroupButton({
  id,
  name,
  didCount,
}: {
  id: string;
  name: string;
  didCount: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/in-groups/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Delete failed (${res.status})`);
      setDeleting(false);
      return;
    }
    router.push('/in-groups');
    router.refresh();
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-error hover:text-error text-sm"
      >
        Delete in-group
      </button>
    );
  }

  return (
    <div className="border border-error/50 bg-error/10 rounded p-4 text-sm">
      <p className="text-error mb-3">
        Delete in-group <span className="font-mono">{name}</span>?{' '}
        {didCount > 0 && (
          <>
            All <span className="tabular-nums">{didCount}</span> attached DID
            {didCount === 1 ? '' : 's'} will be detached.
          </>
        )}
      </p>
      {error && <p className="text-error mb-3">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="bg-error hover:bg-error/90 disabled:opacity-50 text-accent-fg px-3 py-1.5 rounded text-sm"
        >
          {deleting ? 'Deleting…' : 'Yes, delete'}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="px-3 py-1.5 rounded text-sm hover:bg-card-hover text-fg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
