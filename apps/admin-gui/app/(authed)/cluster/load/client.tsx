'use client';

import { useCallback, useEffect, useState } from 'react';

interface Snap {
  node_id: string;
  name: string;
  host: string;
  role: string;
  is_self: boolean;
  status: string;
  reachable: boolean;
  probe_ms: number;
  detail?: string;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpus: number | null;
  load_ratio: number | null;
  mem_used: number | null;
  mem_total: number | null;
  disk_used: number | null;
  disk_total: number | null;
  uptime_s: number | null;
  fs_channels: number | null;
}

function fmtBytes(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

function fmtUptime(s: number | null): string {
  if (s == null || s < 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function pct(used: number | null, total: number | null): number | null {
  if (used == null || total == null || total <= 0) return null;
  return Math.round((used / total) * 100);
}

function Bar({ value, danger }: { value: number | null; danger: number }) {
  if (value == null) {
    return <div className="h-2 rounded bg-card-hover" />;
  }
  const v = Math.max(0, Math.min(100, value));
  const tone =
    v >= danger
      ? 'bg-error'
      : v >= danger * 0.75
        ? 'bg-warn'
        : 'bg-success';
  return (
    <div className="h-2 rounded bg-card-hover overflow-hidden">
      <div
        className={`h-full ${tone}`}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function NodeLoadClient() {
  const [nodes, setNodes] = useState<Snap[]>([]);
  const [ts, setTs] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/cluster/node-load', {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        setErr(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { ts: string; nodes: Snap[] };
      setNodes(data.nodes);
      setTs(data.ts);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  if (loading && nodes.length === 0) {
    return <p className="text-sm text-fg-subtle">Probing nodes…</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-fg-subtle">
        <span>{nodes.length} node(s)</span>
        {ts && <span>· updated {new Date(ts).toLocaleTimeString()}</span>}
        {err && <span className="text-error">· {err}</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {nodes.map((n) => {
          const loadPctVal =
            n.load_ratio != null ? Math.round(n.load_ratio * 100) : null;
          const memPct = pct(n.mem_used, n.mem_total);
          const diskPct = pct(n.disk_used, n.disk_total);
          return (
            <div
              key={n.node_id}
              className={
                n.reachable
                  ? 'border border-border rounded p-4 bg-card'
                  : 'border border-error/40 rounded p-4 bg-error/5'
              }
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-semibold">{n.name}</span>
                  {n.is_self && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border border-border text-fg-subtle">
                      self
                    </span>
                  )}
                  <div className="text-xs text-fg-subtle font-mono">
                    {n.host} · {n.role}
                  </div>
                </div>
                <div className="text-right text-xs">
                  {n.reachable ? (
                    <span className="text-success">● reachable</span>
                  ) : (
                    <span className="text-error">● unreachable</span>
                  )}
                  <div className="text-fg-subtle">{n.probe_ms}ms</div>
                </div>
              </div>

              {n.reachable ? (
                <div className="space-y-2 text-xs">
                  <div>
                    <div className="flex justify-between mb-0.5">
                      <span className="text-fg-subtle">
                        CPU load {n.load1 ?? '—'} / {n.load5 ?? '—'} /{' '}
                        {n.load15 ?? '—'}{' '}
                        <span className="text-fg-muted">
                          ({n.cpus ?? '?'} core)
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {loadPctVal != null ? `${loadPctVal}%` : '—'}
                      </span>
                    </div>
                    <Bar value={loadPctVal} danger={100} />
                  </div>
                  <div>
                    <div className="flex justify-between mb-0.5">
                      <span className="text-fg-subtle">
                        RAM {fmtBytes(n.mem_used)} / {fmtBytes(n.mem_total)}
                      </span>
                      <span className="tabular-nums">
                        {memPct != null ? `${memPct}%` : '—'}
                      </span>
                    </div>
                    <Bar value={memPct} danger={90} />
                  </div>
                  <div>
                    <div className="flex justify-between mb-0.5">
                      <span className="text-fg-subtle">
                        Disk {fmtBytes(n.disk_used)} /{' '}
                        {fmtBytes(n.disk_total)}
                      </span>
                      <span className="tabular-nums">
                        {diskPct != null ? `${diskPct}%` : '—'}
                      </span>
                    </div>
                    <Bar value={diskPct} danger={90} />
                  </div>
                  <div className="flex justify-between pt-1 text-fg-subtle">
                    <span>
                      FS channels:{' '}
                      <span className="text-fg tabular-nums">
                        {n.fs_channels ?? '—'}
                      </span>
                    </span>
                    <span>up {fmtUptime(n.uptime_s)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-error">
                  {n.detail ?? 'probe failed'}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
