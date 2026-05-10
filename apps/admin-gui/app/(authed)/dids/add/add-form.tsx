'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'single' | 'bulk' | 'clone';

interface InGroupOption {
  id: string;
  name: string;
  enabled: boolean;
}

interface BulkResult {
  attempted: number;
  added: string[];
  skipped: Array<{
    raw: string;
    reason: 'invalid_format' | 'already_attached';
    existingOwner?: string;
  }>;
}

export function AddDidForm({
  inGroups,
  existingDids,
}: {
  inGroups: InGroupOption[];
  existingDids: string[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('single');
  const [inGroupId, setInGroupId] = useState(inGroups[0]?.id ?? '');
  const [singleDid, setSingleDid] = useState('');
  const [bulkBlob, setBulkBlob] = useState('');
  const [cloneSource, setCloneSource] = useState(existingDids[0] ?? '');
  const [cloneTo, setCloneTo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      if (mode === 'single') {
        const res = await fetch('/api/dids', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ did: singleDid, in_group_id: inGroupId }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(humanize(j.error, j.existingOwner));
          return;
        }
        setSuccess(`Added ${j.did}.`);
        setSingleDid('');
        router.refresh();
      } else if (mode === 'bulk') {
        const dids = bulkBlob
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter(Boolean);
        if (dids.length === 0) {
          setError('Paste at least one DID.');
          return;
        }
        const res = await fetch('/api/dids', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dids, in_group_id: inGroupId }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(j.error ?? `Bulk add failed (${res.status})`);
          return;
        }
        setResult({
          attempted: j.attempted,
          added: j.added,
          skipped: j.skipped,
        });
        setBulkBlob('');
        router.refresh();
      } else {
        // clone
        const res = await fetch(
          `/api/dids/${encodeURIComponent(cloneSource)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clone_to: cloneTo }),
          },
        );
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(humanize(j.error, j.existingOwner));
          return;
        }
        setSuccess(
          `Cloned ${cloneSource} → ${j.did}. Same in-group attachment.`,
        );
        setCloneTo('');
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-4">
      <div className="flex gap-2">
        <ModeButton current={mode} value="single" onClick={setMode}>
          Single
        </ModeButton>
        <ModeButton current={mode} value="bulk" onClick={setMode}>
          Bulk paste
        </ModeButton>
        <ModeButton
          current={mode}
          value="clone"
          onClick={setMode}
          disabled={existingDids.length === 0}
        >
          Clone existing
        </ModeButton>
      </div>

      {mode !== 'clone' && (
        <label className="block">
          <div className="text-sm font-medium mb-1 flex items-center gap-2">
            In-group
            <Hint text="The in-group these DIDs route inbound calls to. Each DID can only belong to one in-group at a time." />
          </div>
          <select
            value={inGroupId}
            onChange={(e) => setInGroupId(e.target.value)}
            className="input"
            required
          >
            {inGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.enabled ? '' : ' (disabled)'}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode === 'single' && (
        <label className="block">
          <div className="text-sm font-medium mb-1 flex items-center gap-2">
            Phone number
            <Hint text="Digits only or +E.164 (e.g. +14155551234). Will be normalized on save." />
          </div>
          <input
            value={singleDid}
            onChange={(e) => setSingleDid(e.target.value)}
            placeholder="+14155551234"
            className="input font-mono"
            required
            autoFocus
          />
        </label>
      )}

      {mode === 'bulk' && (
        <label className="block">
          <div className="text-sm font-medium mb-1 flex items-center gap-2">
            Phone numbers
            <Hint text="One per line, or separated by commas / spaces. Up to 5,000 at a time. Invalid or already-attached numbers are reported back, the rest are added." />
          </div>
          <textarea
            value={bulkBlob}
            onChange={(e) => setBulkBlob(e.target.value)}
            placeholder={'+14155551234\n+14155551235\n+14155551236'}
            className="input font-mono h-48"
            required
            autoFocus
          />
        </label>
      )}

      {mode === 'clone' && (
        <>
          <label className="block">
            <div className="text-sm font-medium mb-1 flex items-center gap-2">
              Copy settings from
              <Hint text="The new DID will land in the same in-group as this one. Once we add per-DID call menus and office hours, those will copy too." />
            </div>
            <select
              value={cloneSource}
              onChange={(e) => setCloneSource(e.target.value)}
              className="input font-mono"
              required
            >
              {existingDids.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <div className="text-sm font-medium mb-1 flex items-center gap-2">
              New DID
              <Hint text="The new phone number to create with the cloned settings." />
            </div>
            <input
              value={cloneTo}
              onChange={(e) => setCloneTo(e.target.value)}
              placeholder="+14155551235"
              className="input font-mono"
              required
            />
          </label>
        </>
      )}

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-3">
          {error}
        </div>
      )}

      {success && (
        <div className="border border-success/50 bg-success/10 text-success text-sm rounded p-3">
          {success}
        </div>
      )}

      {result && (
        <div className="border border-border rounded p-3 text-sm space-y-2">
          <div className="font-medium">
            Added {result.added.length} of {result.attempted} DIDs
          </div>
          {result.added.length > 0 && (
            <details>
              <summary className="text-fg-muted cursor-pointer text-xs">
                Show {result.added.length} added
              </summary>
              <ul className="font-mono text-xs mt-2 max-h-40 overflow-y-auto">
                {result.added.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </details>
          )}
          {result.skipped.length > 0 && (
            <details open>
              <summary className="text-warn cursor-pointer text-xs">
                {result.skipped.length} skipped
              </summary>
              <ul className="font-mono text-xs mt-2 space-y-1 max-h-60 overflow-y-auto">
                {result.skipped.map((s, i) => (
                  <li key={i} className="text-fg-muted">
                    <span className="text-fg">{s.raw}</span>
                    {' — '}
                    {s.reason === 'invalid_format'
                      ? 'invalid format'
                      : `already attached${s.existingOwner ? ` (in-group ${s.existingOwner.slice(0, 8)})` : ''}`}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm"
        >
          {submitting ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function ModeButton({
  current,
  value,
  onClick,
  children,
  disabled,
}: {
  current: Mode;
  value: Mode;
  onClick: (m: Mode) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm rounded border ${
        active
          ? 'bg-accent text-accent-fg border-accent'
          : 'border-border text-fg-muted hover:text-fg hover:bg-card-hover'
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-border text-[10px] text-fg-muted hover:text-fg hover:border-fg-muted cursor-help"
      title={text}
      aria-label={text}
    >
      ?
    </span>
  );
}

function humanize(error: string | undefined, existingOwner?: string): string {
  if (error === 'invalid_format') {
    return 'Invalid phone format. Use digits or +E.164.';
  }
  if (error === 'already_attached') {
    return `That DID is already attached${existingOwner ? ` to in-group ${existingOwner.slice(0, 8)}` : ''}.`;
  }
  if (error === 'in_group_missing') return 'In-group not found.';
  if (error === 'source_not_found') return 'Source DID not found.';
  return error ?? 'Something went wrong.';
}
