'use client';

import { useEffect, useState } from 'react';

interface ActiveCall {
  id: number;
  ts: string;
  campaign_name: string;
  user_username: string | null;
  phone: string;
  transformed_phone: string;
  call_uuid: string | null;
  answered_at: string | null;
}

interface AgentRow {
  user_id: string;
  username: string;
  display_name: string | null;
  role: string;
  status: string; // AVAILABLE | PAUSED
  pause_reason: string | null;
  call_intent_id: number | null;
  call_phone: string | null;
  call_answered_at: string | null;
  dispositions_today: number;
}

type Mode = 'monitor' | 'whisper' | 'barge';

// Iter 193 — ViciDial-style supervisor board. Two panels:
//   1. Agent roster — EVERY active agent + live state. Monitor a
//      PAUSED agent: you watch them here; the buttons arm the
//      instant their next call connects (2s poll). Eavesdrop is
//      agent-centric (resolves their current live intent server-
//      side).
//   2. Live calls — the call-centric view (legacy iter-65).
// Eavesdrop originates to the supervisor's registered browser
// softphone extension (WebRTC) which answers the eavesdrop leg.

export function SupervisorBoard({ initial }: { initial: ActiveCall[] }) {
  const [calls, setCalls] = useState<ActiveCall[]>(initial);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  useEffect(() => {
    async function tick() {
      try {
        const [c, a] = await Promise.all([
          fetch('/api/supervisor/active-calls', { cache: 'no-store' }),
          fetch('/api/supervisor/agents', { cache: 'no-store' }),
        ]);
        if (c.ok) {
          const j = (await c.json()) as { calls: ActiveCall[] };
          setCalls(j.calls);
        }
        if (a.ok) {
          const j = (await a.json()) as { agents: AgentRow[] };
          setAgents(j.agents);
        }
      } catch {
        /* network blip — skip this tick */
      }
    }
    const id = setInterval(tick, 2000);
    void tick();
    return () => clearInterval(id);
  }, []);

  async function flagForQa(intentId: number) {
    const reason = prompt('Reason for flagging this call for QA?', '');
    if (reason === null) return;
    setBusyKey(`flag-${intentId}`);
    setMsg({ tone: 'ok', text: 'Flagging…' });
    try {
      const res = await fetch('/api/supervisor/flag-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          intent_id: intentId,
          reason: reason || undefined,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setMsg({ tone: 'err', text: j.error ?? 'flag failed' });
        return;
      }
      setMsg({
        tone: 'ok',
        text: 'Flagged — visible on /reports/flagged-calls.',
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function eavesdrop(
    target: { intent_id: number } | { agent_user_id: string },
    mode: Mode,
    key: string,
  ) {
    setBusyKey(key);
    setMsg(null);
    const res = await fetch('/api/supervisor/eavesdrop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...target, mode }),
    });
    setBusyKey(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        agent_state?: string;
        pause_reason?: string | null;
      };
      if (j.error === 'agent_has_no_live_call') {
        setMsg({
          tone: 'err',
          text: `Agent is ${j.agent_state ?? 'idle'}${
            j.pause_reason ? ` (${j.pause_reason})` : ''
          } — no live call to ${mode} yet. The buttons arm when their next call connects.`,
        });
        return;
      }
      setMsg({
        tone: 'err',
        text: j.error ?? `${mode} failed (${res.status})`,
      });
      return;
    }
    setMsg({
      tone: 'ok',
      text: `${mode} started — your softphone is answering the eavesdrop leg.`,
    });
  }

  return (
    <div className="space-y-8">
      {msg && (
        <div
          className={`text-sm ${
            msg.tone === 'ok' ? 'text-success' : 'text-error'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* ---- Agent roster ---- */}
      <section>
        <h2 className="text-sm font-semibold mb-2">
          Agents{' '}
          <span className="text-fg-subtle font-normal">
            ({agents.length} active · monitor paused or on-call)
          </span>
        </h2>
        {agents.length === 0 ? (
          <div className="border border-dashed border-border rounded p-4 text-sm text-fg-subtle">
            No agents online.
          </div>
        ) : (
          <table className="w-full text-sm max-w-5xl">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-2 font-medium">Agent</th>
                <th className="font-medium">State</th>
                <th className="font-medium">On call</th>
                <th className="font-medium tabular-nums">Dur</th>
                <th className="font-medium tabular-nums">Dispo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const onCall = a.call_intent_id != null;
                const state = onCall
                  ? 'ON CALL'
                  : a.status === 'PAUSED'
                    ? 'PAUSED'
                    : 'AVAILABLE';
                const stateCls = onCall
                  ? 'text-info'
                  : a.status === 'PAUSED'
                    ? 'text-warn'
                    : 'text-success';
                const k = `ag-${a.user_id}`;
                return (
                  <tr
                    key={a.user_id}
                    className="border-b border-border/40"
                  >
                    <td className="py-2 font-mono text-xs">
                      {a.username}
                      {a.display_name && (
                        <span className="text-fg-subtle ml-1">
                          ({a.display_name})
                        </span>
                      )}
                    </td>
                    <td className={`text-xs font-medium ${stateCls}`}>
                      {state}
                      {a.status === 'PAUSED' && a.pause_reason && (
                        <span className="text-fg-subtle ml-1 font-normal">
                          {a.pause_reason}
                        </span>
                      )}
                    </td>
                    <td className="text-fg font-mono text-xs">
                      {a.call_phone ?? (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                    <td className="text-fg-muted tabular-nums text-xs">
                      {onCall ? formatDuration(a.call_answered_at) : '—'}
                    </td>
                    <td className="text-fg-muted tabular-nums text-xs">
                      {a.dispositions_today}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <SupButton
                          onClick={() =>
                            eavesdrop(
                              { agent_user_id: a.user_id },
                              'monitor',
                              k,
                            )
                          }
                          busy={busyKey === k}
                          disabled={!onCall}
                          label="Monitor"
                          tone="neutral"
                          title={
                            onCall
                              ? 'Listen in'
                              : 'No live call — arms when their next call connects'
                          }
                        />
                        <SupButton
                          onClick={() =>
                            eavesdrop(
                              { agent_user_id: a.user_id },
                              'whisper',
                              k,
                            )
                          }
                          busy={busyKey === k}
                          disabled={!onCall}
                          label="Whisper"
                          tone="warn"
                        />
                        <SupButton
                          onClick={() =>
                            eavesdrop(
                              { agent_user_id: a.user_id },
                              'barge',
                              k,
                            )
                          }
                          busy={busyKey === k}
                          disabled={!onCall}
                          label="Barge"
                          tone="error"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ---- Live calls (call-centric) ---- */}
      <section>
        <h2 className="text-sm font-semibold mb-2">
          Live calls{' '}
          <span className="text-fg-subtle font-normal">
            ({calls.length})
          </span>
        </h2>
        {calls.length === 0 ? (
          <div className="border border-dashed border-border rounded p-6 text-sm text-fg-subtle">
            No live calls right now. Refreshes every 2 seconds.
          </div>
        ) : (
          <table className="w-full text-sm max-w-5xl">
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
              {calls.map((c) => {
                const k = `call-${c.id}`;
                return (
                  <tr key={c.id} className="border-b border-border/40">
                    <td className="py-2 text-accent">
                      {c.campaign_name}
                    </td>
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
                        <SupButton
                          onClick={() =>
                            eavesdrop({ intent_id: c.id }, 'monitor', k)
                          }
                          busy={busyKey === k}
                          label="Monitor"
                          tone="neutral"
                        />
                        <SupButton
                          onClick={() =>
                            eavesdrop({ intent_id: c.id }, 'whisper', k)
                          }
                          busy={busyKey === k}
                          label="Whisper"
                          tone="warn"
                        />
                        <SupButton
                          onClick={() =>
                            eavesdrop({ intent_id: c.id }, 'barge', k)
                          }
                          busy={busyKey === k}
                          label="Barge"
                          tone="error"
                        />
                        <SupButton
                          onClick={() => flagForQa(c.id)}
                          busy={busyKey === `flag-${c.id}`}
                          label="⚑ Flag"
                          tone="warn"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function SupButton({
  onClick,
  busy,
  label,
  tone,
  disabled,
  title,
}: {
  onClick: () => void;
  busy: boolean;
  label: string;
  tone: 'neutral' | 'warn' | 'error';
  disabled?: boolean;
  title?: string;
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
      disabled={busy || disabled}
      title={title}
      className={`text-xs px-2 py-1 rounded border ${cls} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
}

function formatDuration(answeredAt: string | null): string {
  if (!answeredAt) return '—';
  const secs = Math.max(
    0,
    Math.floor((Date.now() - new Date(answeredAt).getTime()) / 1000),
  );
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
