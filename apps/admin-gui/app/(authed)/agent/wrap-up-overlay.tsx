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
  duration_ms: number | null;
}

const DISPOSITIONS: Array<{ code: string; label: string; tone: string }> = [
  { code: 'SALE', label: 'Sale', tone: 'success' },
  { code: 'CALLBACK', label: 'Callback', tone: 'warn' },
  { code: 'NO_INTEREST', label: 'No interest', tone: 'neutral' },
  { code: 'ANSWERING_MACHINE', label: 'Voicemail', tone: 'neutral' },
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

  async function submit() {
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

    // Resume only if we paused them.
    if (pausedByUsRef.current) {
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
    }

    setIntent(null);
    setBusy(false);
    router.refresh();
  }

  if (!intent) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-lg p-6 mx-4">
        <header className="mb-4">
          <h2 className="text-lg font-semibold">Wrap-up — disposition required</h2>
          <p className="text-fg-subtle text-sm mt-1">
            Dial intent {intent.id}. Pick a disposition to end wrap-up
            and resume taking calls.
          </p>
        </header>

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

        <div className="flex items-center justify-between">
          <span className="text-[11px] text-fg-subtle">
            Calls paused until you submit.
          </span>
          <button
            type="button"
            onClick={submit}
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
