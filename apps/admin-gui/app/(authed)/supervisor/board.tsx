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

type Mode = 'monitor' | 'whisper' | 'barge';

export function SupervisorBoard({ initial }: { initial: ActiveCall[] }) {
  const [calls, setCalls] = useState<ActiveCall[]>(initial);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch('/api/supervisor/active-calls', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const j = (await res.json()) as { calls: ActiveCall[] };
        setCalls(j.calls);
      } catch {
        /* network blip — skip this tick */
      }
    }, 2000);
    return () => clearInterval(id);
  }, []);

  async function flagForQa(intentId: number) {
    const reason = prompt('Reason for flagging this call for QA?', '');
    if (reason === null) return;
    setBusyId(intentId);
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
        setMsg({ tone: "err", text: j.error ?? "flag failed" });
        return;
      }
      setMsg({
        tone: 'ok',
        text: 'Flagged — visible on /reports/flagged-calls.',
      });
    } finally {
      setBusyId(null);
    }
  }

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
      text: `${mode} started — your softphone is answering the eavesdrop leg.`,
    });
  }

  return (
    <div>
      {msg && (
        <div
          className={`mb-3 text-sm ${
            msg.tone === 'ok' ? 'text-success' : 'text-error'
          }`}
        >
          {msg.text}
        </div>
      )}
      {calls.length === 0 ? (
        <div className="border border-dashed border-border rounded p-6 text-sm text-fg-subtle">
          No live calls right now. The list refreshes every 2 seconds.
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
            {calls.map((c) => (
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
                    <SupButton
                      onClick={() => eavesdrop(c.id, 'monitor')}
                      busy={busyId === c.id}
                      label="Monitor"
                      tone="neutral"
                    />
                    <SupButton
                      onClick={() => eavesdrop(c.id, 'whisper')}
                      busy={busyId === c.id}
                      label="Whisper"
                      tone="warn"
                    />
                    <SupButton
                      onClick={() => eavesdrop(c.id, 'barge')}
                      busy={busyId === c.id}
                      label="Barge"
                      tone="error"
                    />
                    <SupButton
                      onClick={() => flagForQa(c.id)}
                      busy={busyId === c.id}
                      label="⚑ Flag"
                      tone="warn"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SupButton({
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
      className={`text-xs px-2 py-1 rounded border ${cls} disabled:opacity-50`}
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
