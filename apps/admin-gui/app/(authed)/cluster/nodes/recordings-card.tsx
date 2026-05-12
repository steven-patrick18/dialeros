'use client';

import { useCallback, useEffect, useState } from 'react';

// Iter 113 — recordings disk-use card for /cluster/nodes. Surfaces
// total bytes, file count, oldest age, and expirable count
// against the configured retention window. "Sweep now" button lets
// an admin force the cleanup without waiting for the 24h cron.

interface Stats {
  path: string;
  exists: boolean;
  total_bytes: number;
  file_count: number;
  expirable_count: number;
  oldest_age_days: number | null;
  retention_days: number;
}

export function RecordingsCard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/cluster/recordings', { cache: 'no-store' });
      if (r.ok) {
        const j = (await r.json()) as Stats;
        setStats(j);
      }
    } catch {
      /* offline blip — keep last value */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function sweep() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/cluster/recordings', { method: 'POST' });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        removed?: number;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        setMsg({ tone: 'err', text: j.error ?? `sweep failed (${r.status})` });
      } else {
        setMsg({
          tone: 'ok',
          text: `Removed ${j.removed ?? 0} expired recording(s).`,
        });
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!stats) {
    return (
      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Recordings disk usage
        </h2>
        <p className="text-fg-subtle text-sm">Loading…</p>
      </div>
    );
  }

  if (!stats.exists) {
    return (
      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Recordings disk usage
        </h2>
        <p className="text-fg-subtle text-sm">
          No recordings directory yet at{' '}
          <span className="font-mono">{stats.path}</span>. Created on the
          first answered live call. Retention is set to{' '}
          {stats.retention_days}d.
        </p>
      </div>
    );
  }

  const usageTone =
    stats.total_bytes > 50 * 1024 * 1024 * 1024 // >50 GiB
      ? 'text-warn'
      : stats.total_bytes > 100 * 1024 * 1024 * 1024 // >100 GiB
        ? 'text-error'
        : 'text-fg';

  return (
    <div className="border border-border rounded p-4 mb-6 max-w-4xl">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          Recordings disk usage
        </h2>
        <span className="text-xs text-fg-subtle font-mono">{stats.path}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Stat
          label="Total size"
          value={formatBytes(stats.total_bytes)}
          tone={usageTone}
          hint="Sum of .wav file sizes in the recordings tree"
        />
        <Stat
          label="File count"
          value={stats.file_count.toLocaleString()}
          tone={stats.file_count > 0 ? 'text-fg' : 'text-fg-subtle'}
          hint="One .wav per answered live call"
        />
        <Stat
          label="Oldest"
          value={
            stats.oldest_age_days === null
              ? '—'
              : stats.oldest_age_days < 1
                ? '<1d'
                : `${stats.oldest_age_days}d`
          }
          tone={
            stats.oldest_age_days !== null &&
            stats.oldest_age_days > stats.retention_days
              ? 'text-warn'
              : 'text-fg-muted'
          }
          hint="Age of the oldest file on disk"
        />
        <Stat
          label="Expirable"
          value={stats.expirable_count.toLocaleString()}
          tone={stats.expirable_count > 0 ? 'text-warn' : 'text-fg-subtle'}
          hint={`Files older than ${stats.retention_days}d — eligible for the next sweep`}
        />
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-subtle">
          Retention: {stats.retention_days}d. Daily sweep runs
          automatically; use the button to force one now.
        </p>
        <button
          type="button"
          onClick={sweep}
          disabled={busy || stats.expirable_count === 0}
          className="text-xs px-3 py-1 rounded border border-warn/50 text-warn hover:bg-warn/10 disabled:opacity-40"
        >
          {busy ? 'Sweeping…' : 'Sweep now'}
        </button>
      </div>
      {msg && (
        <p
          className={`text-xs mt-2 ${msg.tone === 'ok' ? 'text-success' : 'text-error'}`}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: string;
  hint: string;
}) {
  return (
    <div
      title={hint}
      className="border border-border rounded p-2 cursor-help"
    >
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={`text-lg mt-0.5 tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}
