'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface FloorSnap {
  dialing: number;
  connected: number;
  last_1m: number;
  last_10m: number;
  last_60m: number;
  today: number;
  completed_today: number;
  failed_today: number;
}

interface CampaignTodayRow {
  id: string;
  name: string;
  type: string;
  status: string;
  today: number;
  last_1m: number;
}

interface Snapshot {
  generated_at: string;
  floor: FloorSnap;
  campaigns_today: CampaignTodayRow[];
  agents: {
    total: number;
    available: number;
    in_call: number;
    paused: number;
    dispo_today: number;
  };
  health: {
    nodes_total: number;
    nodes_ready: number;
    carriers_total: number;
    carriers_enabled: number;
    route_plans_total: number;
    route_plans_enabled: number;
    campaigns_total: number;
    campaigns_active: number;
  };
}

export function DashboardBoard({ initial }: { initial: Snapshot }) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [connected, setConnected] = useState(true);

  // Iter 96 — 10s poll. Reads cheap, lets the operator leave the
  // dashboard open as a passive monitor.
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const res = await fetch('/api/dashboard/snapshot', {
          cache: 'no-store',
        });
        if (!res.ok) {
          setConnected(false);
          return;
        }
        const j = (await res.json()) as Snapshot;
        if (cancelled) return;
        setSnap(j);
        setConnected(true);
      } catch {
        setConnected(false);
      }
    }
    const id = setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const successRate =
    snap.floor.completed_today + snap.floor.failed_today > 0
      ? (
          (snap.floor.completed_today /
            (snap.floor.completed_today + snap.floor.failed_today)) *
          100
        ).toFixed(1)
      : null;

  return (
    <div className="space-y-8">
      {!connected && (
        <div className="text-xs text-warn">
          (snapshot stalled — reconnecting…)
        </div>
      )}

      {/* Live floor — what's happening this very second. */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Live floor
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 max-w-6xl">
          <Stat
            label="Dialing"
            value={snap.floor.dialing}
            tone={snap.floor.dialing > 0 ? 'info' : 'muted'}
            hint="real (non-simulated) originates ringing right now"
          />
          <Stat
            label="Connected"
            value={snap.floor.connected}
            tone={snap.floor.connected > 0 ? 'success' : 'muted'}
            hint="answered + still up"
          />
          <Stat
            label="Available agents"
            value={snap.agents.available}
            tone={snap.agents.available > 0 ? 'success' : 'muted'}
          />
          <Stat
            label="On call"
            value={snap.agents.in_call}
            tone={snap.agents.in_call > 0 ? 'accent' : 'muted'}
          />
          <Stat
            label="Paused"
            value={snap.agents.paused}
            tone={snap.agents.paused > 0 ? 'warn' : 'muted'}
          />
          <Stat
            label="Calls / 1m"
            value={snap.floor.last_1m}
            tone={snap.floor.last_1m > 0 ? 'accent' : 'muted'}
            hint="originates fired in the last 60 seconds"
          />
        </div>
      </section>

      {/* Today's outcomes — talked-to vs failed buckets. */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Today
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 max-w-6xl">
          <Stat
            label="Calls today"
            value={snap.floor.today}
            tone={snap.floor.today > 0 ? 'fg' : 'muted'}
            hint="all originates since midnight (UTC)"
          />
          <Stat
            label="Completed"
            value={snap.floor.completed_today}
            tone="success"
            hint="NORMAL_CLEARING with answer — i.e. talked-to leads"
          />
          <Stat
            label="Failed"
            value={snap.floor.failed_today}
            tone={snap.floor.failed_today > 0 ? 'warn' : 'muted'}
            hint="busy + no-answer + bad-number + rejected combined"
          />
          {successRate !== null && (
            <Stat
              label="Talk %"
              value={`${successRate}%`}
              tone="success"
              hint="completed / (completed + failed)"
            />
          )}
          <Stat
            label="Dispo today"
            value={snap.agents.dispo_today}
            tone={snap.agents.dispo_today > 0 ? 'success' : 'muted'}
            hint="agent-side dispositions logged today"
          />
          <Stat
            label="Last 10m"
            value={snap.floor.last_10m}
            tone="muted"
            hint="originates in the last 10 minutes"
          />
        </div>
      </section>

      {/* Top campaigns today */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Top campaigns today
        </h2>
        {snap.campaigns_today.length === 0 ? (
          <p className="text-fg-subtle text-sm">
            No campaign activity today yet.
          </p>
        ) : (
          <table className="w-full text-sm max-w-5xl">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-2 font-medium">Campaign</th>
                <th className="font-medium">Type</th>
                <th className="font-medium">Status</th>
                <th className="font-medium tabular-nums text-right">
                  Last 1m
                </th>
                <th className="font-medium tabular-nums text-right">Today</th>
              </tr>
            </thead>
            <tbody>
              {snap.campaigns_today.map((c) => (
                <tr key={c.id} className="border-b border-border/40">
                  <td className="py-2">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="text-fg-muted font-mono text-xs">
                    {c.type}
                  </td>
                  <td>
                    <span
                      className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                        c.status === 'active'
                          ? 'bg-success/15 text-success border-success/50'
                          : c.status === 'paused'
                            ? 'bg-warn/15 text-warn border-warn/40'
                            : 'bg-card-hover/40 text-fg-muted border-border'
                      }`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td
                    className={`tabular-nums text-right ${
                      c.last_1m > 0 ? 'text-accent' : 'text-fg-subtle'
                    }`}
                  >
                    {c.last_1m}
                  </td>
                  <td className="tabular-nums text-right text-fg">
                    {c.today.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Cluster health */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Cluster
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-4xl">
          <HealthStat
            label="Nodes ready"
            ready={snap.health.nodes_ready}
            total={snap.health.nodes_total}
            href="/cluster/nodes"
          />
          <HealthStat
            label="Carriers enabled"
            ready={snap.health.carriers_enabled}
            total={snap.health.carriers_total}
            href="/carriers"
          />
          <HealthStat
            label="Route plans"
            ready={snap.health.route_plans_enabled}
            total={snap.health.route_plans_total}
            href="/route-plans"
          />
          <HealthStat
            label="Campaigns active"
            ready={snap.health.campaigns_active}
            total={snap.health.campaigns_total}
            href="/campaigns"
          />
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = 'fg',
  hint,
}: {
  label: string;
  value: number | string;
  tone?: 'success' | 'warn' | 'error' | 'info' | 'accent' | 'fg' | 'muted';
  hint?: string;
}) {
  const colour = {
    success: 'text-success',
    warn: 'text-warn',
    error: 'text-error',
    info: 'text-info',
    accent: 'text-accent',
    fg: 'text-fg',
    muted: 'text-fg-muted',
  }[tone];
  return (
    <div
      title={hint}
      className="border border-border rounded p-3 cursor-help"
    >
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={`text-2xl mt-1 tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}

function HealthStat({
  label,
  ready,
  total,
  href,
}: {
  label: string;
  ready: number;
  total: number;
  href: string;
}) {
  const tone =
    total === 0
      ? 'text-fg-muted'
      : ready === total
        ? 'text-success'
        : ready === 0
          ? 'text-warn'
          : 'text-info';
  return (
    <Link
      href={href}
      className="border border-border rounded p-3 block hover:bg-card-hover/40"
    >
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={`text-2xl mt-1 tabular-nums ${tone}`}>
        {ready} <span className="text-fg-subtle text-base">/ {total}</span>
      </div>
    </Link>
  );
}
