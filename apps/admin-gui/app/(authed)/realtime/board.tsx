'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  dial_mode: string;
  type: string;
  dial_level: number;
  hopper_level: number;
  hopper_depth: number;
  in_flight: number;
  carrier_id: string | null;
  carrier_name: string | null;
  carrier_enabled: number | null;
  amd_action: string;
}

interface AgentRow {
  user_id: string;
  username: string;
  display_name: string | null;
  role: string;
  is_active: number;
  manual_dial: number;
  status: string;
  pause_reason: string | null;
  call_intent_id: number | null;
  call_phone: string | null;
  call_answered_at: string | null;
  dispositions_today: number;
}

interface ActiveCall {
  id: number;
  ts: string;
  campaign_id: string;
  campaign_name: string;
  user_username: string | null;
  phone: string;
  transformed_phone: string;
  call_uuid: string | null;
  answered_at: string | null;
}

// Iter 85 — per-carrier live state + windowed throughput. Matches
// CarrierLiveRow from db.ts.
interface CarrierRow {
  carrier_id: string;
  carrier_name: string;
  enabled: number;
  dialing: number;
  connected: number;
  last_1m: number;
  last_10m: number;
  last_60m: number;
  completed_60m: number;
  failed_60m: number;
}

interface Snapshot {
  generated_at: string;
  remote_line_capacity: number;
  campaigns: CampaignRow[];
  agents: AgentRow[];
  active_calls: ActiveCall[];
  carriers: CarrierRow[];
}

type Mode = 'monitor' | 'whisper' | 'barge';

export function RealtimeBoard({ initial }: { initial: Snapshot }) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/realtime/snapshot', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const j = (await res.json()) as Snapshot;
        setSnap(j);
      } catch {
        /* network blip — keep the last good snapshot */
      }
    }, 2000);
    return () => clearInterval(id);
  }, []);

  async function eavesdrop(intentId: number, mode: Mode) {
    setBusyId(intentId);
    setMsg(null);
    const res = await fetch('/api/supervisor/eavesdrop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent_id: intentId, mode }),
    });
    setBusyId(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({
        tone: 'err',
        text: j.error ?? `${mode} failed (${res.status})`,
      });
      return;
    }
    setMsg({
      tone: 'ok',
      text: `${mode} started — your softphone will pick up the eavesdrop leg.`,
    });
  }

  // Rolling totals across active campaigns / carriers.
  const totalHopper = snap.campaigns.reduce((a, c) => a + c.hopper_depth, 0);
  // Iter 85 — floor-wide carrier rollup: dialing / connected /
  // 1-min throughput across every carrier.
  const totalDialing = snap.carriers.reduce((a, c) => a + c.dialing, 0);
  const totalConnected = snap.carriers.reduce(
    (a, c) => a + c.connected,
    0,
  );
  const totalRate1m = snap.carriers.reduce((a, c) => a + c.last_1m, 0);
  const agentsAvailable = snap.agents.filter(
    (a) => a.status === 'AVAILABLE' && a.call_intent_id === null,
  ).length;
  const agentsInCall = snap.agents.filter(
    (a) => a.call_intent_id !== null,
  ).length;
  const agentsPaused = snap.agents.filter(
    (a) => a.status === 'PAUSED' && a.call_intent_id === null,
  ).length;
  const dispoToday = snap.agents.reduce(
    (a, x) => a + x.dispositions_today,
    0,
  );

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 max-w-6xl">
        <Stat label="Available" value={agentsAvailable} accent="text-success" />
        <Stat label="On call" value={agentsInCall} accent="text-accent" />
        <Stat label="Paused" value={agentsPaused} accent="text-warn" />
        {/* Iter 85 — floor-wide call-state rollup pulled from the
            per-carrier snapshot. Dialing vs Connected at a glance. */}
        <Stat
          label="Dialing"
          value={totalDialing}
          accent={totalDialing > 0 ? 'text-info' : 'text-fg-muted'}
          hint="real originates currently ringing across all carriers"
        />
        <Stat
          label="Connected"
          value={totalConnected}
          accent={totalConnected > 0 ? 'text-success' : 'text-fg-muted'}
          hint="answered + still up across all carriers"
        />
        <Stat
          label="Calls / 1m"
          value={totalRate1m}
          accent={totalRate1m > 0 ? 'text-accent' : 'text-fg-muted'}
          hint="originates fired in the last 60 seconds across the floor"
        />
        <Stat
          label="Hopper depth"
          value={totalHopper}
          hint="across all campaigns"
        />
        <Stat
          label="Dispo today"
          value={dispoToday}
          accent={dispoToday > 0 ? 'text-success' : 'text-fg-muted'}
        />
      </div>

      <section>
        <h2 className="text-sm font-medium mb-2">Campaigns ({snap.campaigns.length})</h2>
        {snap.campaigns.length === 0 ? (
          <p className="text-fg-subtle text-sm">No campaigns.</p>
        ) : (
          <table className="w-full text-sm max-w-6xl">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-2 font-medium">Campaign</th>
                <th className="font-medium">Status</th>
                <th className="font-medium">Dial mode</th>
                <th className="font-medium">Carrier</th>
                <th className="font-medium">On answer</th>
                <th className="font-medium tabular-nums">Dial level</th>
                <th className="font-medium tabular-nums">Hopper</th>
                <th className="font-medium tabular-nums">In-flight</th>
              </tr>
            </thead>
            <tbody>
              {snap.campaigns.map((c) => (
                <tr key={c.id} className="border-b border-border/40">
                  <td className="py-2">
                    <Link href={`/campaigns/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-fg-subtle text-xs ml-2 font-mono">
                      {c.type}
                    </span>
                  </td>
                  <td>
                    <StatusBadge value={c.status.toUpperCase()} />
                  </td>
                  <td className="text-fg-muted font-mono text-xs">
                    {c.dial_mode}
                  </td>
                  <td className="text-fg">
                    {c.carrier_id ? (
                      <Link
                        href={`/carriers/${c.carrier_id}`}
                        className="hover:underline"
                      >
                        {c.carrier_name}
                      </Link>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                    {c.carrier_id && c.carrier_enabled === 0 && (
                      <span className="ml-2 text-warn text-[10px] uppercase">
                        disabled
                      </span>
                    )}
                  </td>
                  <td className="text-fg-muted font-mono text-xs">
                    {c.amd_action}
                  </td>
                  <td className="tabular-nums text-fg">{c.dial_level.toFixed(1)}</td>
                  <td className="tabular-nums">
                    <span className="text-fg">{c.hopper_depth}</span>
                    <span className="text-fg-subtle"> / {c.hopper_level}</span>
                  </td>
                  <td className="tabular-nums text-accent">{c.in_flight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Iter 85 — per-carrier live state. Mirrors the campaign
          board but pivoted on the carrier so an operator can spot
          which trunk is hot, which is failing, and how throughput
          tracks across 1m / 10m / 60m windows.
       */}
      <section>
        <h2 className="text-sm font-medium mb-2">
          Carriers ({snap.carriers.length})
        </h2>
        {snap.carriers.length === 0 ? (
          <p className="text-fg-subtle text-sm">No carriers configured.</p>
        ) : (
          <table className="w-full text-sm max-w-6xl">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-2 font-medium">Carrier</th>
                <th className="font-medium">Enabled</th>
                <th className="font-medium tabular-nums">Dialing</th>
                <th className="font-medium tabular-nums">Connected</th>
                <th className="font-medium tabular-nums">Last 1m</th>
                <th className="font-medium tabular-nums">Last 10m</th>
                <th className="font-medium tabular-nums">Last 60m</th>
                <th className="font-medium tabular-nums">Completed 60m</th>
                <th className="font-medium tabular-nums">Failed 60m</th>
              </tr>
            </thead>
            <tbody>
              {snap.carriers.map((cr) => (
                <tr
                  key={cr.carrier_id}
                  className="border-b border-border/40"
                >
                  <td className="py-2">
                    <Link
                      href={`/carriers/${cr.carrier_id}`}
                      className="hover:underline"
                    >
                      {cr.carrier_name}
                    </Link>
                  </td>
                  <td>
                    {cr.enabled === 1 ? (
                      <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
                        ENABLED
                      </span>
                    ) : (
                      <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
                        DISABLED
                      </span>
                    )}
                  </td>
                  <td
                    className={`tabular-nums ${
                      cr.dialing > 0 ? 'text-info' : 'text-fg-subtle'
                    }`}
                  >
                    {cr.dialing}
                  </td>
                  <td
                    className={`tabular-nums ${
                      cr.connected > 0 ? 'text-success' : 'text-fg-subtle'
                    }`}
                  >
                    {cr.connected}
                  </td>
                  <td className="tabular-nums text-fg">{cr.last_1m}</td>
                  <td className="tabular-nums text-fg-muted">
                    {cr.last_10m}
                  </td>
                  <td className="tabular-nums text-fg-muted">
                    {cr.last_60m}
                  </td>
                  <td className="tabular-nums text-success/80">
                    {cr.completed_60m}
                  </td>
                  <td
                    className={`tabular-nums ${
                      cr.failed_60m > 0 ? 'text-warn' : 'text-fg-subtle'
                    }`}
                  >
                    {cr.failed_60m}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-xs text-fg-subtle mt-2 max-w-3xl">
          Dialing = real (non-simulated) originates currently
          ringing (no answer yet). Connected = answered + still up.
          Last-1m / 10m / 60m = originates fired in that window.
          Completed 60m = NORMAL_CLEARING with answer in the last
          hour (talked-to leads). Failed 60m = everything else that
          hung up in the last hour (rejects, busy, no-answer,
          bad-number combined).
        </p>
      </section>

      <section>
        <h2 className="text-sm font-medium mb-2">
          Agents ({snap.agents.length})
        </h2>
        {snap.agents.length === 0 ? (
          <p className="text-fg-subtle text-sm">No active users.</p>
        ) : (
          <table className="w-full text-sm max-w-6xl">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-2 font-medium">Username</th>
                <th className="font-medium">Role</th>
                <th className="font-medium">Status</th>
                <th className="font-medium">Current call</th>
                <th className="font-medium tabular-nums">Duration</th>
                <th className="font-medium tabular-nums">Dispo today</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {snap.agents.map((a) => {
                const inCall = a.call_intent_id !== null;
                const displayStatus = inCall
                  ? 'IN_CALL'
                  : a.status;
                return (
                  <tr key={a.user_id} className="border-b border-border/40">
                    <td className="py-2 font-mono">
                      <Link
                        href={`/users/${a.user_id}`}
                        className="hover:underline"
                      >
                        {a.username}
                      </Link>
                    </td>
                    <td className="text-fg-muted text-xs font-mono">{a.role}</td>
                    <td>
                      <StatusBadge value={displayStatus} />
                      {displayStatus === 'PAUSED' && a.pause_reason && (
                        <span className="text-fg-subtle text-[10px] ml-2">
                          ({a.pause_reason})
                        </span>
                      )}
                    </td>
                    <td className="text-fg-muted font-mono text-xs">
                      {a.call_phone ?? (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                    <td className="text-fg-muted tabular-nums text-xs">
                      {formatDuration(a.call_answered_at)}
                    </td>
                    <td className="tabular-nums text-fg">
                      {a.dispositions_today}
                    </td>
                    <td className="text-right">
                      {inCall && a.call_intent_id !== null && (
                        <div className="flex justify-end gap-1.5">
                          <ActionButton
                            onClick={() =>
                              eavesdrop(a.call_intent_id!, 'monitor')
                            }
                            busy={busyId === a.call_intent_id}
                            label="Mon"
                            tone="neutral"
                          />
                          <ActionButton
                            onClick={() =>
                              eavesdrop(a.call_intent_id!, 'whisper')
                            }
                            busy={busyId === a.call_intent_id}
                            label="Whisp"
                            tone="warn"
                          />
                          <ActionButton
                            onClick={() =>
                              eavesdrop(a.call_intent_id!, 'barge')
                            }
                            busy={busyId === a.call_intent_id}
                            label="Barge"
                            tone="error"
                          />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium mb-2">
          Live calls ({snap.active_calls.length})
        </h2>
        {msg && (
          <div
            className={`mb-2 text-sm ${
              msg.tone === 'ok' ? 'text-success' : 'text-error'
            }`}
          >
            {msg.text}
          </div>
        )}
        {snap.active_calls.length === 0 ? (
          <p className="text-fg-subtle text-sm">No bridged calls right now.</p>
        ) : (
          <table className="w-full text-sm max-w-6xl">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-2 font-medium">Campaign</th>
                <th className="font-medium">Agent</th>
                <th className="font-medium">Number</th>
                <th className="font-medium tabular-nums">Duration</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {snap.active_calls.map((c) => (
                <tr key={c.id} className="border-b border-border/40">
                  <td className="py-2 text-accent">{c.campaign_name}</td>
                  <td className="text-fg-muted font-mono text-xs">
                    {c.user_username ?? (
                      <span className="text-fg-subtle">(remote)</span>
                    )}
                  </td>
                  <td className="text-fg font-mono text-xs">
                    {c.transformed_phone}
                  </td>
                  <td className="text-fg-muted tabular-nums text-xs">
                    {formatDuration(c.answered_at)}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1.5">
                      <ActionButton
                        onClick={() => eavesdrop(c.id, 'monitor')}
                        busy={busyId === c.id}
                        label="Mon"
                        tone="neutral"
                      />
                      <ActionButton
                        onClick={() => eavesdrop(c.id, 'whisper')}
                        busy={busyId === c.id}
                        label="Whisp"
                        tone="warn"
                      />
                      <ActionButton
                        onClick={() => eavesdrop(c.id, 'barge')}
                        busy={busyId === c.id}
                        label="Barge"
                        tone="error"
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-[11px] text-fg-subtle">
        Snapshot at {new Date(snap.generated_at).toLocaleTimeString()} ·
        Remote line capacity: {snap.remote_line_capacity}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = 'text-fg',
  hint,
}: {
  label: string;
  value: number;
  accent?: string;
  hint?: string;
}) {
  return (
    <div className="border border-border rounded p-3 bg-card/50">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={`text-xl mt-1 tabular-nums ${accent}`}>
        {value.toLocaleString()}
      </div>
      {hint && (
        <div className="text-[10px] text-fg-subtle mt-1">{hint}</div>
      )}
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-success/15 text-success border-success/50',
    PAUSED: 'bg-warn/15 text-warn border-warn/40',
    AVAILABLE: 'bg-success/15 text-success border-success/50',
    IN_CALL: 'bg-accent/15 text-accent border-accent/50',
    ARCHIVED: 'bg-card-hover/40 text-fg-muted border-border',
    DISABLED: 'bg-card-hover/40 text-fg-muted border-border',
  };
  const cls = map[value] ?? 'bg-card-hover/40 text-fg-muted border-border';
  return (
    <span className={`${cls} border px-2 py-0.5 rounded text-[10px] uppercase tracking-wide`}>
      {value.replace('_', ' ')}
    </span>
  );
}

function ActionButton({
  onClick,
  busy,
  label,
  tone,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
  tone: 'neutral' | 'warn' | 'error';
}) {
  const cls =
    tone === 'warn'
      ? 'border-warn/40 text-warn hover:bg-warn/10'
      : tone === 'error'
        ? 'border-error/40 text-error hover:bg-error/10'
        : 'border-border text-fg-muted hover:bg-card-hover';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`text-xs px-2 py-0.5 rounded border ${cls} disabled:opacity-50`}
    >
      {label}
    </button>
  );
}

function formatDuration(answeredAt: string | null): string {
  if (!answeredAt) return '—';
  const started = new Date(answeredAt).getTime();
  if (Number.isNaN(started)) return '—';
  const secs = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
