'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSoftphone } from '@/components/softphone';

// Iter 46 — ViciDial-style wrap-up flow.
//
// On the agent panel, watch the softphone for a call ending (inCall
// flips true → false). When that happens, pull the latest undisposed
// intent assigned to me; if there is one, auto-pause the agent and
// show a blocking modal asking for a disposition. After the agent
// dispositions, resume them (only if WE paused them) and dismiss.
//
// The agent feed below already supports inline disposition for older
// rows — the modal is purely the wrap-up gate for the most recent
// call. ViciDial's "wait for dispo" / "must dispo" semantics.

interface WrapUpIntent {
  id: number;
  campaign_name: string;
  phone: string;
  transformed_phone: string;
  lead_name: string | null;
  hangup_cause: string | null;
  hangup_at: string | null;
  duration_ms: number | null;
}

// Iter 102 — wrap-up time budget. Once elapsed crosses this the
// modal escalates from neutral → warn → error to nudge the agent
// who's parked on a dispo for too long. Tunable per-campaign in a
// later iter; 30s is a sane single-call budget for most flows.
const WRAP_UP_WARN_SECONDS = 30;
const WRAP_UP_ESCALATE_SECONDS = 90;

const DISPOSITIONS: Array<{ code: string; label: string; tone: string }> = [
  { code: 'SALE', label: 'Sale', tone: 'success' },
  { code: 'CALLBACK', label: 'Callback', tone: 'warn' },
  { code: 'SURVEYED', label: 'Surveyed', tone: 'success' },
  { code: 'VOICEMAIL_DROPPED', label: 'VM dropped', tone: 'warn' },
  { code: 'NO_INTEREST', label: 'No interest', tone: 'neutral' },
  { code: 'ANSWERING_MACHINE', label: 'Hit AM', tone: 'neutral' },
  { code: 'WRONG_NUMBER', label: 'Wrong #', tone: 'neutral' },
  { code: 'BAD_NUMBER', label: 'Bad #', tone: 'neutral' },
  { code: 'DNC', label: 'DNC', tone: 'error' },
];

export function WrapUpOverlay() {
  const sp = useSoftphone();
  const router = useRouter();
  const [intent, setIntent] = useState<WrapUpIntent | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [callbackAt, setCallbackAt] = useState<string>(() =>
    defaultCallbackLocal(),
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pausedByUsRef = useRef(false);
  const wasInCallRef = useRef(sp.inCall);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Iter 102 — recover after a page refresh / tab return. The
  // inCall-transition handler only fires when the softphone
  // observes the call ending in *this* session; if the agent
  // refreshes the tab mid-wrap-up, we miss the transition and
  // the modal never appears, leaving the intent in OPEN state
  // (visible in iter-99's per-campaign dispo card). Sticky
  // recovery: on mount, ask the server if there's an undisposed
  // intent with hangup_at set — that's a wrap-up we should
  // surface again.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/agent/intents/wrap-up', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const j = (await res.json()) as { intent: WrapUpIntent | null };
        // Only surface if the call has actually ended — otherwise
        // we'd open the modal during a live call. The wrap-up API
        // doesn't filter for hangup so we gate on it here.
        if (cancelled || !j.intent || !j.intent.hangup_at) return;
        // Re-pause if the agent had resumed manually since the
        // original wrap-up was opened — otherwise the pacer would
        // bridge a fresh call while this modal is up. Mirror the
        // call-end path: only auto-pause if currently AVAILABLE
        // so we don't overwrite a Break / Lunch / etc. reason the
        // agent picked themselves.
        const statusRes = await fetch('/api/agent/status', {
          cache: 'no-store',
        });
        const statusJson = statusRes.ok
          ? ((await statusRes.json()) as { status: string })
          : { status: 'AVAILABLE' };
        if (statusJson.status === 'AVAILABLE') {
          await fetch('/api/agent/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'PAUSED', reason: 'wrap-up' }),
          });
          pausedByUsRef.current = true;
        }
        setIntent(j.intent);
        setChosen(null);
        setNote('');
        setError(null);
        setCallbackAt(defaultCallbackLocal());
      } catch {
        /* network blip — wait for next call-end transition */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Iter 102 — tick the elapsed-time display each second while the
  // modal is open. Stops as soon as the modal closes to avoid the
  // setState-while-unmounted footgun.
  useEffect(() => {
    if (!intent) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [intent]);

  // Detect end-of-call transition.
  useEffect(() => {
    const wasInCall = wasInCallRef.current;
    wasInCallRef.current = sp.inCall;
    if (!(wasInCall && !sp.inCall)) return;

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/agent/intents/wrap-up', {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const j = (await res.json()) as { intent: WrapUpIntent | null };
        if (cancelled || !j.intent) return;

        // Auto-pause so the pacer doesn't bridge another call until
        // we've dispositioned this one. Track that WE paused them so
        // we don't accidentally un-pause an agent who paused
        // themselves earlier.
        const statusRes = await fetch('/api/agent/status', {
          cache: 'no-store',
        });
        const statusJson = statusRes.ok
          ? ((await statusRes.json()) as { status: string })
          : { status: 'AVAILABLE' };
        if (statusJson.status === 'AVAILABLE') {
          await fetch('/api/agent/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'PAUSED', reason: 'wrap-up' }),
          });
          pausedByUsRef.current = true;
        }

        setIntent(j.intent);
        setChosen(null);
        setNote('');
        setError(null);
        setCallbackAt(defaultCallbackLocal());
      } catch {
        /* network error — silently skip; agent can dispose from feed */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sp.inCall]);

  async function submit(resumeAfter: boolean) {
    if (!intent || !chosen) return;
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { disposition: chosen };
    if (chosen === 'CALLBACK') {
      try {
        body.callback_at = new Date(callbackAt).toISOString();
      } catch {
        setError('Invalid callback time.');
        setBusy(false);
        return;
      }
    }
    if (note.trim().length > 0) body.note = note.trim();

    try {
      const res = await fetch(
        `/api/agent/intents/${intent.id}/dispose`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `dispose failed (${res.status})`);
        setBusy(false);
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error');
      setBusy(false);
      return;
    }

    // Iter 56 — resume only if we paused them AND the agent picked
    // the "Submit & resume" path. "Submit & stay paused" leaves
    // them PAUSED so they can immediately do a manual dial without
    // a second click on Pause.
    if (resumeAfter && pausedByUsRef.current) {
      try {
        await fetch('/api/agent/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'AVAILABLE' }),
        });
      } catch {
        /* best-effort */
      }
      pausedByUsRef.current = false;
    } else if (!resumeAfter) {
      // Forget the "we paused them" flag so a later wrap-up doesn't
      // think it owns the pause and accidentally resume.
      pausedByUsRef.current = false;
    }

    setIntent(null);
    setBusy(false);
    router.refresh();
  }

  if (!intent) return null;

  // Iter 102 — elapsed time since the call hung up. We anchor on
  // hangup_at when present (sticky-recovery case after a refresh
  // can be many minutes in) and fall back to "modal first opened"
  // for the natural call-end path so the counter still starts at
  // 0s instead of jumping mid-call.
  const hangupMs = intent.hangup_at ? Date.parse(intent.hangup_at) : nowMs;
  const elapsedSec = Math.max(0, Math.floor((nowMs - hangupMs) / 1000));
  const escalationTone =
    elapsedSec >= WRAP_UP_ESCALATE_SECONDS
      ? 'error'
      : elapsedSec >= WRAP_UP_WARN_SECONDS
        ? 'warn'
        : 'neutral';
  const borderClass =
    escalationTone === 'error'
      ? 'border-error/70 ring-1 ring-error/40'
      : escalationTone === 'warn'
        ? 'border-warn/60'
        : 'border-border';
  const timerClass =
    escalationTone === 'error'
      ? 'text-error'
      : escalationTone === 'warn'
        ? 'text-warn'
        : 'text-fg-muted';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`bg-card border rounded-lg shadow-2xl w-full max-w-lg p-6 mx-4 ${borderClass}`}
      >
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              Wrap-up — disposition required
            </h2>
            <p className="text-fg-subtle text-sm mt-1">
              Dial intent {intent.id}. Pick a disposition to end wrap-up
              and resume taking calls.
            </p>
          </div>
          <div
            className={`tabular-nums font-mono text-lg ${timerClass}`}
            title="Elapsed wrap-up time since call hangup"
          >
            {formatElapsed(elapsedSec)}
          </div>
        </header>
        {escalationTone === 'error' && (
          <p className="bg-error/10 text-error border border-error/40 rounded px-3 py-2 text-xs mb-4">
            Wrap-up exceeding {WRAP_UP_ESCALATE_SECONDS}s — your campaign
            throughput is paused while this is open. Pick a disposition
            now or your supervisor will see this in the OPEN bucket.
          </p>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mb-4 border border-border rounded p-3 bg-bg">
          <Detail label="Campaign" value={intent.campaign_name} mono />
          <Detail
            label="Lead"
            value={intent.lead_name ?? <span className="text-fg-subtle">—</span>}
          />
          <Detail label="Number dialed" value={intent.transformed_phone} mono />
          <Detail
            label="Hangup cause"
            value={
              intent.hangup_cause ?? (
                <span className="text-fg-subtle">pending</span>
              )
            }
            mono
          />
          {typeof intent.duration_ms === 'number' && (
            <Detail
              label="Duration"
              value={
                intent.duration_ms > 0
                  ? formatDuration(intent.duration_ms)
                  : '—'
              }
              mono
            />
          )}
        </dl>

        <div className="mb-3">
          <div className="text-xs uppercase tracking-wide text-fg-muted mb-2">
            Disposition
          </div>
          <div className="grid grid-cols-2 gap-2">
            {DISPOSITIONS.map((d) => (
              <button
                key={d.code}
                type="button"
                onClick={() => setChosen(d.code)}
                disabled={busy}
                className={`text-sm px-3 py-2 rounded border text-left ${dispoClasses(
                  d.tone,
                  chosen === d.code,
                )}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {chosen === 'CALLBACK' && (
          <div className="mb-3">
            <label className="block">
              <div className="text-xs uppercase tracking-wide text-fg-muted mb-1">
                Callback time
              </div>
              <input
                type="datetime-local"
                value={callbackAt}
                onChange={(e) => setCallbackAt(e.target.value)}
                className="input"
              />
            </label>
          </div>
        )}

        <div className="mb-4">
          <label className="block">
            <div className="text-xs uppercase tracking-wide text-fg-muted mb-1">
              Notes (optional)
            </div>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="input h-20"
              placeholder="What happened on the call…"
            />
          </label>
        </div>

        {error && (
          <div className="text-error text-sm mb-3">{error}</div>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-fg-subtle flex-1">
            Calls paused until you submit.
          </span>
          <button
            type="button"
            onClick={() => {
              void submit(false);
            }}
            disabled={!chosen || busy}
            className="border border-border hover:border-fg-muted text-fg-muted hover:text-fg px-3 py-2 rounded text-sm disabled:opacity-40"
            title="Submit and stay paused — useful before a manual dial"
          >
            Submit & stay paused
          </button>
          <button
            type="button"
            onClick={() => {
              void submit(true);
            }}
            disabled={!chosen || busy}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Submit & resume'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </dt>
      <dd className={`text-fg ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function dispoClasses(tone: string, active: boolean): string {
  if (tone === 'success') {
    return active
      ? 'bg-success/15 text-success border-success/60'
      : 'border-border hover:border-success/50 text-success';
  }
  if (tone === 'warn') {
    return active
      ? 'bg-warn/15 text-warn border-warn/60'
      : 'border-border hover:border-warn/50 text-warn';
  }
  if (tone === 'error') {
    return active
      ? 'bg-error/15 text-error border-error/60'
      : 'border-border hover:border-error/50 text-error';
  }
  return active
    ? 'bg-card-hover text-fg border-fg-muted'
    : 'border-border hover:border-fg-muted text-fg-muted';
}

function defaultCallbackLocal(): string {
  // datetime-local needs YYYY-MM-DDTHH:MM in *local* time, not ISO.
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `0:${String(sec).padStart(2, '0')}`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
