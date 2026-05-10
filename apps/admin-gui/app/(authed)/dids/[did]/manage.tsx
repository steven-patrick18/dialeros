'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface InGroupOption {
  id: string;
  name: string;
  enabled: boolean;
}

export function ManageDid({
  did,
  currentInGroupId,
  inGroups,
}: {
  did: string;
  currentInGroupId: string;
  inGroups: InGroupOption[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState(currentInGroupId);
  const [cloneTo, setCloneTo] = useState('');
  const [busy, setBusy] = useState<'move' | 'clone' | 'delete' | null>(null);
  const [msg, setMsg] = useState<{
    tone: 'ok' | 'err';
    text: string;
  } | null>(null);

  async function move() {
    if (target === currentInGroupId) {
      setMsg({ tone: 'err', text: 'Pick a different in-group to move to.' });
      return;
    }
    setBusy('move');
    setMsg(null);
    try {
      const res = await fetch(`/api/dids/${encodeURIComponent(did)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ in_group_id: target }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: 'err', text: j.error ?? `move failed (${res.status})` });
        return;
      }
      setMsg({ tone: 'ok', text: 'Moved.' });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function clone() {
    if (!cloneTo) {
      setMsg({ tone: 'err', text: 'Enter the new DID number to clone to.' });
      return;
    }
    setBusy('clone');
    setMsg(null);
    try {
      const res = await fetch(`/api/dids/${encodeURIComponent(did)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clone_to: cloneTo }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({
          tone: 'err',
          text:
            j.error === 'already_attached'
              ? `That number is already attached${j.existingOwner ? ` to in-group ${j.existingOwner.slice(0, 8)}` : ''}.`
              : j.error === 'invalid_format'
                ? 'Invalid phone format.'
                : (j.error ?? `clone failed (${res.status})`),
        });
        return;
      }
      setMsg({ tone: 'ok', text: `Cloned to ${j.did}.` });
      setCloneTo('');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !confirm(
        `Delete DID ${did}? Calls to this number will stop routing to its in-group.`,
      )
    ) {
      return;
    }
    setBusy('delete');
    setMsg(null);
    try {
      const res = await fetch(`/api/dids/${encodeURIComponent(did)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setMsg({
          tone: 'err',
          text: j.error ?? `delete failed (${res.status})`,
        });
        return;
      }
      router.push('/dids');
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="border border-border rounded p-4">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Move to a different in-group
        </h2>
        <div className="flex gap-3 items-end">
          <label className="flex-1">
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="input"
            >
              {inGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                  {g.enabled ? '' : ' (disabled)'}
                  {g.id === currentInGroupId ? ' — current' : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={move}
            disabled={busy !== null}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {busy === 'move' ? 'Moving…' : 'Move'}
          </button>
        </div>
      </div>

      <div className="border border-border rounded p-4">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Clone these settings to a new DID
        </h2>
        <p className="text-xs text-fg-subtle mb-3">
          Creates a new phone number attached to the same in-group as this
          one. Other per-DID settings (call menu, office hours) will follow
          when those land.
        </p>
        <div className="flex gap-3 items-end">
          <label className="flex-1">
            <input
              value={cloneTo}
              onChange={(e) => setCloneTo(e.target.value)}
              placeholder="+14155551235"
              className="input font-mono"
            />
          </label>
          <button
            type="button"
            onClick={clone}
            disabled={busy !== null}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {busy === 'clone' ? 'Cloning…' : 'Clone'}
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`border rounded p-3 text-sm ${
            msg.tone === 'ok'
              ? 'border-success/50 bg-success/10 text-success'
              : 'border-error/50 bg-error/10 text-error'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={remove}
          disabled={busy !== null}
          className="text-error text-sm hover:underline disabled:opacity-50"
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete this DID'}
        </button>
      </div>
    </div>
  );
}
