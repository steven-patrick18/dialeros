'use client';

import { useEffect, useState } from 'react';

interface GatewayStatus {
  pushed: boolean;
  state?: string;
  pingTime?: string;
  rawSnippet?: string;
  error?: string;
}

// State is now formatted as "<reg-state>/<status>" (e.g. NOREG/UP for a
// healthy ip-acl gateway, REGED/UP for digest, NOREG/DOWN when OPTIONS
// pings fail). Match the most-specific combos first.
const STATE_COLORS: Record<string, string> = {
  'REGED/UP': 'bg-success/15 text-success border-success/40',
  'NOREG/UP': 'bg-success/15 text-success border-success/40',
  REGED: 'bg-success/15 text-success border-success/40',
  TRYING: 'bg-warn/15 text-warn border-warn/40',
  REGISTER: 'bg-warn/15 text-warn border-warn/40',
  UNREGED: 'bg-fg-subtle/15 text-fg-muted border-border',
  FAILED: 'bg-error/15 text-error border-error/40',
  FAIL_WAIT: 'bg-error/15 text-error border-error/40',
  NOREG: 'bg-fg-subtle/15 text-fg-muted border-border',
  NOAVAIL: 'bg-error/15 text-error border-error/40',
};

function colorFor(state: string | undefined): string {
  if (!state) return 'bg-fg-subtle/15 text-fg-muted border-border';
  if (STATE_COLORS[state]) return STATE_COLORS[state];
  // Fall back to matching just the part before the slash (REGED, NOREG)
  // or whatever single token we got.
  const head = state.split('/')[0];
  if (head && STATE_COLORS[head]) return STATE_COLORS[head];
  // Anything containing DOWN reads as a problem.
  if (/DOWN/i.test(state)) return 'bg-error/15 text-error border-error/40';
  return 'bg-fg-subtle/15 text-fg-muted border-border';
}

export function FreeSwitchPanel({ carrierId }: { carrierId: string }) {
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch(
        `/api/carriers/${carrierId}/freeswitch-status`,
        { cache: 'no-store' },
      );
      const j = (await res.json().catch(() => ({}))) as GatewayStatus;
      setStatus(j);
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carrierId]);

  async function push() {
    setPushing(true);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/carriers/${carrierId}/push-to-freeswitch`,
        { method: 'POST' },
      );
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        step?: string;
        gateway?: string;
      };
      if (!res.ok || !j.ok) {
        setMsg({
          tone: 'err',
          text: j.error
            ? `${j.step ?? 'push'}: ${j.error}`
            : `push failed (${res.status})`,
        });
        return;
      }
      setMsg({
        tone: 'ok',
        text: j.message ?? `pushed gateway ${j.gateway}`,
      });
      // Status takes a beat to update — re-poll soon.
      setTimeout(() => refresh(), 1000);
    } finally {
      setPushing(false);
    }
  }

  const stateBadge = status?.state ? (
    <span
      className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${colorFor(status.state)}`}
    >
      {status.state}
    </span>
  ) : null;

  return (
    <div className="border border-border rounded p-4 max-w-4xl">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          FreeSWITCH gateway
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

      <p className="text-xs text-fg-subtle mb-3">
        Push this carrier to FreeSWITCH as a SIP gateway. The dialer&apos;s
        outbound INVITEs go through whichever gateway the route plan picks.
        Re-push after editing host / port / auth / codecs above.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3 text-sm">
        <Stat
          label="Pushed?"
          value={
            status === null ? (
              <span className="text-fg-subtle">checking…</span>
            ) : status.pushed ? (
              <span className="text-success">yes</span>
            ) : (
              <span className="text-warn">no</span>
            )
          }
        />
        <Stat
          label="Gateway state"
          value={
            stateBadge ?? (
              <span className="text-fg-subtle">—</span>
            )
          }
        />
        <Stat
          label="Ping"
          value={
            status?.pingTime ? (
              <span className="font-mono text-xs">{status.pingTime}</span>
            ) : (
              <span className="text-fg-subtle">—</span>
            )
          }
        />
      </div>

      {status?.error && (
        <div className="text-xs text-fg-subtle border border-border rounded p-2 mb-3">
          ESL ping failed: <span className="font-mono">{status.error}</span>.
          Normal before FreeSWITCH is installed.
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={push}
          disabled={pushing}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-40"
        >
          {pushing ? 'Pushing…' : status?.pushed ? 'Re-push to FreeSWITCH' : 'Push to FreeSWITCH'}
        </button>
        {msg && (
          <span
            className={`text-xs ${
              msg.tone === 'ok' ? 'text-success' : 'text-error'
            }`}
          >
            {msg.text}
          </span>
        )}
      </div>

      {status?.rawSnippet && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-fg-subtle hover:text-fg-muted">
            sofia status output
          </summary>
          <pre className="mt-2 max-h-48 overflow-y-auto bg-card/70 border border-border rounded p-2 font-mono text-[11px] whitespace-pre-wrap">
            {status.rawSnippet}
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
