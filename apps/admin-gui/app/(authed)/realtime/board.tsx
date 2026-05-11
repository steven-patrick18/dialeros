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

interface Snapshot {
  generated_at: string;
  remote_line_capacity: number;
  campaigns: CampaignRow[];
  agents: AgentRow[];
  active_calls: ActiveCall[];
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

  // Rolling totals across active campaigns.
  const totalInFlight = snap.campaigns.reduce(
    (a, c) => a + c.in_flight,
    0,
  );
  const totalHopper = snap.campaigns.reduce((a, c) => a + c.hopper_depth, 0);
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
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 max-w-6xl">
        <Stat label="Available" value={agentsAvailable} accent="text-success" />
        <Stat label="On call" value={agentsInCall} accent="text-accent" />
        <Stat label="Paused" value={agentsPaused} accent="text-warn" />
        <Stat label="In-flight calls" value={totalInFlight} accent="text-accent" />
        <Stat label="Hopper depth" value={totalHopper} hint="across all campaigns" />
        <Stat label="Dispositions today" value={dispoToday} accent={dispoToday > 0 ? 'text-success' : 'text-fg-muted'} />
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
