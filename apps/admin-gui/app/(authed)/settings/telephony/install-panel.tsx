'use client';

import { useEffect, useState } from 'react';

interface Status {
  reachable: boolean;
  version?: string;
  uptime?: string;
  sessions?: number;
  error?: string;
  errorCode?: string;
}

export function InstallPanel({ hasToken }: { hasToken: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<
    { ok: boolean; error?: string } | null
  >(null);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/telephony/status', { cache: 'no-store' });
      const j = (await res.json().catch(() => ({}))) as Status;
      setStatus(j);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refresh();
    // Re-check every 15s — covers post-install state without manual refresh.
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, []);

  async function install() {
    if (
      !confirm(
        'Install FreeSWITCH on this host? This downloads the SignalWire FreeSWITCH packages and starts the service. Takes 2-5 minutes.',
      )
    ) {
      return;
    }
    setInstalling(true);
    setInstallLog(null);
    setInstallResult(null);
    try {
      const res = await fetch('/api/telephony/install', { method: 'POST' });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        log?: string;
        error?: string;
      };
      setInstallLog(j.log ?? null);
      setInstallResult({ ok: !!j.ok, error: j.error });
      // Status will reflect the new state after a refresh.
      await refresh();
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="border border-border rounded p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          FreeSWITCH
        </h2>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="text-xs text-fg-muted hover:text-fg disabled:opacity-50"
        >
          {refreshing ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4 text-sm">
        <Stat
          label="Reachable"
          value={
            status === null ? (
              <span className="text-fg-subtle">checking…</span>
            ) : status.reachable ? (
              <span className="text-success">yes</span>
            ) : (
              <span className="text-warn">no</span>
            )
          }
        />
        <Stat
          label="Version"
          value={
            status?.version ? (
              <span className="font-mono text-xs">{status.version}</span>
            ) : (
              <span className="text-fg-subtle">—</span>
            )
          }
        />
        <Stat
          label="Uptime"
          value={
            status?.uptime ? (
              <span className="text-xs">{status.uptime}</span>
            ) : (
              <span className="text-fg-subtle">—</span>
            )
          }
        />
      </div>

      {status && !status.reachable && (
        <div className="text-xs text-fg-subtle mb-3 border border-border rounded p-2">
          ESL ping failed: <span className="font-mono">{status.errorCode}</span>{' '}
          — {status.error}. Normal before install; click below if you have a
          token saved.
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={install}
          disabled={installing || !hasToken}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-40"
          title={
            hasToken
              ? 'Run the install script on this host'
              : 'Save a SignalWire token above first'
          }
        >
          {installing ? 'Installing… (this can take 2-5 min)' : 'Install FreeSWITCH'}
        </button>
        {!hasToken && (
          <span className="text-xs text-fg-subtle">
            Save a SignalWire token above to enable.
          </span>
        )}
      </div>

      {installResult && (
        <div
          className={`mt-3 text-xs rounded border p-2 ${
            installResult.ok
              ? 'border-success/50 bg-success/10 text-success'
              : 'border-error/50 bg-error/10 text-error'
          }`}
        >
          {installResult.ok
            ? 'Install completed. Refreshing status…'
            : `Install failed: ${installResult.error ?? 'see log'}`}
        </div>
      )}

      {installLog && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-fg-subtle hover:text-fg-muted">
            Install log ({installLog.length} chars)
          </summary>
          <pre className="mt-2 max-h-72 overflow-y-auto bg-card/70 border border-border rounded p-2 font-mono text-[11px] whitespace-pre-wrap">
            {installLog}
          </pre>
        </details>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded p-2">
      <div className="text-[10px] uppercase text-fg-subtle">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}
