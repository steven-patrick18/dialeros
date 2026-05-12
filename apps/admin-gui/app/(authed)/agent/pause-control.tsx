'use client';

import { useEffect, useState } from 'react';

// Iter 101 — pause / resume control on the agent console header.
// The pacer's pickAgent already skips PAUSED users (iter 40); this
// is the missing UI half so an agent can actually transition into
// that state with a reason instead of admins flipping it in the
// DB. ViciDial-style reason codes are surfaced as quick-pick chips
// to keep the click-cost low — a step-away should be one click,
// not a form. "Other" lets the agent type a free-form reason for
// the rare case nothing fits.

interface AgentStatus {
  user_id: string;
  status: string;
  reason: string | null;
  updated_at: string;
}

const PAUSE_REASONS = [
  'Break',
  'Lunch',
  'Training',
  'Meeting',
  'Restroom',
  'Coaching',
];

export function PauseControl({ initial }: { initial: AgentStatus }) {
  const [status, setStatus] = useState<AgentStatus>(initial);
  const [menuOpen, setMenuOpen] = useState(false);
  const [otherText, setOtherText] = useState('');
  const [busy, setBusy] = useState(false);

  // Keep the chip in sync if the supervisor flips someone's status
  // server-side — cheap poll on top of the existing /api/agent/*
  // endpoints. 15s is fine; pause state changes are agent-driven
  // and rare from the supervisor side.
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/agent/status', { cache: 'no-store' });
        if (r.ok) {
          const j = (await r.json()) as AgentStatus;
          setStatus(j);
        }
      } catch {
        // network blip — keep last state, will retry next tick
      }
    }, 15_000);
    return () => clearInterval(id);
  }, []);

  async function applyPause(reason: string | null) {
    setBusy(true);
    try {
      const r = await fetch('/api/agent/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'PAUSED', reason }),
      });
      if (r.ok) {
        const j = (await r.json()) as AgentStatus;
        setStatus(j);
        setMenuOpen(false);
        setOtherText('');
      }
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    setBusy(true);
    try {
      const r = await fetch('/api/agent/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'AVAILABLE' }),
      });
      if (r.ok) {
        const j = (await r.json()) as AgentStatus;
        setStatus(j);
      }
    } finally {
      setBusy(false);
    }
  }

  const isPaused = status.status === 'PAUSED';

  if (isPaused) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded border bg-warn/15 text-warn border-warn/40">
          PAUSED
          {status.reason && (
            <span className="ml-1 normal-case tracking-normal">
              · {status.reason}
            </span>
          )}
        </span>
        <button
          type="button"
          onClick={resume}
          disabled={busy}
          className="text-xs px-3 py-1 rounded border border-success/50 text-success hover:bg-success/10 disabled:opacity-40"
        >
          Resume
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded border bg-success/15 text-success border-success/50">
          AVAILABLE
        </span>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          disabled={busy}
          className="text-xs px-3 py-1 rounded border border-warn/50 text-warn hover:bg-warn/10 disabled:opacity-40"
        >
          Pause
        </button>
      </div>
      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-20 bg-card border border-border rounded shadow-lg p-2 w-56">
          <p className="text-[10px] uppercase tracking-wide text-fg-subtle mb-2 px-1">
            Pause reason
          </p>
          <div className="flex flex-wrap gap-1 mb-2">
            {PAUSE_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => applyPause(r)}
                disabled={busy}
                className="text-xs px-2 py-1 rounded border border-border text-fg-muted hover:bg-card-hover/50 hover:text-fg disabled:opacity-40"
              >
                {r}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value.slice(0, 120))}
              placeholder="Other reason"
              className="flex-1 text-xs px-2 py-1 rounded border border-border bg-bg text-fg placeholder:text-fg-subtle focus:outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && otherText.trim()) {
                  applyPause(otherText.trim());
                }
              }}
            />
            <button
              type="button"
              onClick={() =>
                otherText.trim() && applyPause(otherText.trim())
              }
              disabled={busy || !otherText.trim()}
              className="text-xs px-2 py-1 rounded border border-warn/50 text-warn hover:bg-warn/10 disabled:opacity-40"
            >
              Go
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setOtherText('');
            }}
            className="text-[10px] text-fg-subtle hover:text-fg mt-2 block w-full text-center"
          >
            cancel
          </button>
        </div>
      )}
    </div>
  );
}
