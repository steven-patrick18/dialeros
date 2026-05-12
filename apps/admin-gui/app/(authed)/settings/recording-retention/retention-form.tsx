'use client';

import { useState } from 'react';

// Iter 144 — client form for /settings/recording-retention.
// Two knobs (days + enabled) + Preview/Prune-now buttons that hit
// /api/internal/prune-recordings (which accepts admin session
// auth as well as the systemd token).

interface Props {
  initial: { retention_days: number; enabled: boolean };
}

interface PruneResult {
  enabled: boolean;
  retention_days: number;
  cutoff_iso: string;
  scanned: number;
  deleted: number;
  freed_bytes: number;
  db_rows_cleared: number;
  dry_run: boolean;
  errors: string[];
  note?: string;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

export function RetentionForm({ initial }: Props) {
  const [days, setDays] = useState<number>(initial.retention_days);
  const [enabled, setEnabled] = useState<boolean>(initial.enabled);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [pruneBusy, setPruneBusy] = useState<'preview' | 'apply' | null>(
    null,
  );
  const [pruneResult, setPruneResult] = useState<PruneResult | null>(null);
  const [pruneErr, setPruneErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaveMsg(null);
    setSaveErr(null);
    try {
      const res = await fetch('/api/settings/recording-retention', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retention_days: days, enabled }),
      });
      if (!res.ok) {
        setSaveErr(`HTTP ${res.status}: ${await res.text()}`);
      } else {
        setSaveMsg('Saved.');
      }
    } catch (e) {
      setSaveErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runPrune(dryRun: boolean) {
    setPruneBusy(dryRun ? 'preview' : 'apply');
    setPruneErr(null);
    setPruneResult(null);
    try {
      const qs = dryRun ? '?dry_run=1' : '';
      const res = await fetch(`/api/internal/prune-recordings${qs}`, {
        method: 'POST',
      });
      if (!res.ok) {
        setPruneErr(`HTTP ${res.status}: ${await res.text()}`);
        return;
      }
      setPruneResult((await res.json()) as PruneResult);
    } catch (e) {
      setPruneErr((e as Error).message);
    } finally {
      setPruneBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3 border border-border rounded p-4 bg-card">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span className="text-sm">Enable nightly prune</span>
        </label>
        <label className="flex flex-col gap-1 max-w-xs">
          <span className="text-sm text-fg-subtle">Retention (days)</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="input"
          />
          <span className="text-xs text-fg-subtle">
            Files older than this (by mtime) are deleted on the next
            tick. Min 1, max 3650 (10 years).
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {saveMsg ? (
            <span className="text-success text-sm">{saveMsg}</span>
          ) : null}
          {saveErr ? (
            <span className="text-error text-sm">{saveErr}</span>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 border border-border rounded p-4 bg-card">
        <h2 className="text-sm font-semibold">Run now</h2>
        <p className="text-xs text-fg-subtle">
          Preview shows what the nightly tick WOULD do under the
          current settings, without deleting anything. Apply runs the
          actual prune. Disabled (in the toggle above) means both
          return zero — flip the toggle on first.
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            disabled={pruneBusy !== null}
            onClick={() => runPrune(true)}
            className="bg-bg-elevated hover:bg-card-hover border border-border px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {pruneBusy === 'preview' ? 'Scanning…' : 'Preview'}
          </button>
          <button
            type="button"
            disabled={pruneBusy !== null}
            onClick={() => runPrune(false)}
            className="bg-error hover:opacity-90 text-white px-4 py-2 rounded text-sm disabled:opacity-50"
          >
            {pruneBusy === 'apply' ? 'Pruning…' : 'Prune now'}
          </button>
        </div>
        {pruneErr ? (
          <p className="text-error text-sm">{pruneErr}</p>
        ) : null}
        {pruneResult ? (
          <div className="text-sm space-y-1 mt-3 font-mono">
            <div>
              <span className="text-fg-subtle">enabled: </span>
              {String(pruneResult.enabled)}
            </div>
            <div>
              <span className="text-fg-subtle">cutoff: </span>
              {new Date(pruneResult.cutoff_iso).toLocaleString()} (
              {pruneResult.retention_days}d)
            </div>
            <div>
              <span className="text-fg-subtle">scanned: </span>
              {pruneResult.scanned}
            </div>
            <div>
              <span className="text-fg-subtle">
                {pruneResult.dry_run ? 'would delete' : 'deleted'}:{' '}
              </span>
              {pruneResult.deleted}
            </div>
            <div>
              <span className="text-fg-subtle">
                {pruneResult.dry_run ? 'would free' : 'freed'}:{' '}
              </span>
              {fmtBytes(pruneResult.freed_bytes)}
            </div>
            <div>
              <span className="text-fg-subtle">db rows cleared: </span>
              {pruneResult.db_rows_cleared}
            </div>
            {pruneResult.note ? (
              <div className="text-warn">{pruneResult.note}</div>
            ) : null}
            {pruneResult.errors.length > 0 ? (
              <details className="text-error">
                <summary className="cursor-pointer">
                  {pruneResult.errors.length} error
                  {pruneResult.errors.length === 1 ? '' : 's'}
                </summary>
                <ul className="list-disc pl-5 mt-1">
                  {pruneResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
