'use client';

import { useEffect, useRef, useState } from 'react';

interface DialIntent {
  id: number;
  ts: string;
  campaign_id: string;
  lead_id: string;
  route_plan_id: string;
  phone: string;
  transformed_phone: string;
  cid_used: string | null;
  kind: string;
  assigned_username: string | null;
  answered_at: string | null;
  hangup_at: string | null;
  hangup_cause: string | null;
  originate_error: string | null;
  duration_ms: number | null;
}

interface ThroughputSnapshot {
  active_now: number;
  last_1m: number;
  last_10m: number;
  last_60m: number;
  total: number;
}

export function PacingPanel({
  campaignId,
  isActive,
  initialTotal,
}: {
  campaignId: string;
  isActive: boolean;
  initialTotal: number;
}) {
  // Iter 78 — keyed by intent.id so an update for the same row
  // replaces the old state instead of duplicating it.
  const [intents, setIntents] = useState<DialIntent[]>([]);
  const [connected, setConnected] = useState(false);
  // Iter 84 — instead of a single ambiguous "total dial intents"
  // (which lifetime-monotonically counted up and made the panel
  // look like the pacer was firing huge volumes when actually the
  // cap was working), the header now shows a 5-number snapshot:
  // active-now / 1m / 10m / 60m / lifetime. Polled every 5s from a
  // tiny throughput endpoint backed by indexed (campaign_id, ts)
  // queries.
  const [snap, setSnap] = useState<ThroughputSnapshot>({
    active_now: 0,
    last_1m: 0,
    last_10m: 0,
    last_60m: 0,
    total: initialTotal,
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    const es = new EventSource(`/api/campaigns/${campaignId}/intents/events`);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'intent') {
          const incoming = data.intent as DialIntent;
          setIntents((prev) => {
            const idx = prev.findIndex((p) => p.id === incoming.id);
            if (idx === -1) {
              return [...prev, incoming].slice(-200);
            }
            const next = prev.slice();
            next[idx] = incoming;
            return next;
          });
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [campaignId]);

  // Iter 84 — poll throughput snapshot every 5s. Cheap query, gives
  // a clear "calls per minute / 10 / 60" view that doesn't conflate
  // lifetime count with current activity.
  useEffect(() => {
    let cancelled = false;
    async function fetchSnap() {
      try {
        const res = await fetch(
          `/api/campaigns/${campaignId}/throughput`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const j = (await res.json()) as ThroughputSnapshot;
        if (!cancelled) setSnap(j);
      } catch {
        /* ignore */
      }
    }
    fetchSnap();
    const handle = setInterval(fetchSnap, 5000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [campaignId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [intents]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    userScrolledRef.current = !atBottom;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase text-fg-subtle">Pacer</span>
          {isActive ? (
            <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
              RUNNING
            </span>
          ) : (
            <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
              IDLE
            </span>
          )}
          {!connected && (
            <span className="text-xs text-fg-subtle">(reconnecting…)</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs">
          <StatChip
            label="Active now"
            value={snap.active_now}
            tone={snap.active_now > 0 ? 'live' : 'muted'}
            hint="Real (non-simulated) dial-intents with no hangup yet — i.e. calls currently in flight on the trunk."
          />
          <StatChip
            label="Last 1m"
            value={snap.last_1m}
            tone="muted"
            hint="Originates fired in the last 60 seconds."
          />
          <StatChip
            label="Last 10m"
            value={snap.last_10m}
            tone="muted"
            hint="Originates fired in the last 10 minutes."
          />
          <StatChip
            label="Last 60m"
            value={snap.last_60m}
            tone="muted"
            hint="Originates fired in the last hour."
          />
          <StatChip
            label="Lifetime"
            value={snap.total}
            tone="muted"
            hint="Total dial intents ever recorded for this campaign."
          />
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-72 overflow-y-auto p-3 font-mono text-xs space-y-0.5 bg-card/70 border border-border rounded"
      >
        {intents.length === 0 ? (
          <div className="text-fg-subtle">
            {isActive
              ? 'Pacer is running — dial intents will appear here every ~3s.'
              : 'Pacer is idle. Flip status to ACTIVE to start the pacer.'}
          </div>
        ) : (
          intents.map((i) => <IntentLine key={i.id} intent={i} />)
        )}
        {isActive && <div className="text-fg-subtle animate-pulse">▌</div>}
      </div>
    </div>
  );
}

function StatChip({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: 'live' | 'muted';
  hint: string;
}) {
  return (
    <span
      title={hint}
      className="inline-flex flex-col items-end leading-tight cursor-help"
    >
      <span className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
      <span
        className={`tabular-nums font-mono ${
          tone === 'live' ? 'text-success' : 'text-fg'
        }`}
      >
        {value.toLocaleString()}
      </span>
    </span>
  );
}

interface CallState {
  label: string;
  tone:
    | 'dialing'
    | 'ringing'
    | 'connected'
    | 'completed'
    | 'busy'
    | 'no_answer'
    | 'bad_number'
    | 'rejected'
    | 'error'
    | 'simulated';
  detail?: string;
}

/** Iter 78 — derive a ViciDial-style state label from raw intent
 * fields. Order matters: errors / rejections win over transient
 * states like DIALING. */
function deriveCallState(i: DialIntent): CallState {
  if (i.kind === 'simulated') {
    return { label: 'SIMULATED', tone: 'simulated' };
  }
  if (i.originate_error) {
    return {
      label: 'REJECTED',
      tone: 'rejected',
      detail: i.originate_error,
    };
  }
  if (i.kind === 'originate_failed') {
    return { label: 'ERROR', tone: 'error' };
  }
  // Hung up — final state derived from cause.
  if (i.hangup_at) {
    const cause = i.hangup_cause ?? 'UNKNOWN';
    if (cause === 'NORMAL_CLEARING') {
      // Completed normally. If answered_at is null, the leg was
      // cancelled before answer — that's effectively NO_ANSWER for
      // operator reading.
      if (!i.answered_at) {
        return { label: 'CANCELLED', tone: 'no_answer', detail: cause };
      }
      return { label: 'COMPLETED', tone: 'completed', detail: cause };
    }
    if (cause === 'USER_BUSY' || cause === 'CALL_REJECTED') {
      return { label: 'BUSY', tone: 'busy', detail: cause };
    }
    if (
      cause === 'NO_ANSWER' ||
      cause === 'NO_USER_RESPONSE' ||
      cause === 'ALLOTTED_TIMEOUT'
    ) {
      return { label: 'NO_ANSWER', tone: 'no_answer', detail: cause };
    }
    if (
      cause === 'UNALLOCATED_NUMBER' ||
      cause === 'INVALID_NUMBER_FORMAT' ||
      cause === 'NUMBER_CHANGED' ||
      cause === 'NO_ROUTE_DESTINATION' ||
      cause === 'DESTINATION_OUT_OF_ORDER'
    ) {
      return { label: 'BAD_NUMBER', tone: 'bad_number', detail: cause };
    }
    if (cause === 'ORIGINATOR_CANCEL') {
      return { label: 'CANCELLED', tone: 'no_answer', detail: cause };
    }
    return { label: cause, tone: 'error', detail: cause };
  }
  // No hangup yet.
  if (i.answered_at) {
    return { label: 'CONNECTED', tone: 'connected' };
  }
  // bgapi succeeded, ringing.
  if (i.kind === 'originated') {
    return { label: 'DIALING', tone: 'dialing' };
  }
  // Fallback for pre-iter-78 rows or pacer-internal states.
  return { label: i.kind.toUpperCase(), tone: 'dialing' };
}

const TONE_CLASSES: Record<CallState['tone'], string> = {
  dialing: 'text-info',
  ringing: 'text-info',
  connected: 'text-success',
  completed: 'text-success',
  busy: 'text-warn',
  no_answer: 'text-warn',
  bad_number: 'text-error',
  rejected: 'text-error',
  error: 'text-error',
  simulated: 'text-fg-subtle',
};

function IntentLine({ intent }: { intent: DialIntent }) {
  const time = formatTime(intent.ts);
  const state = deriveCallState(intent);
  return (
    <div className="flex gap-3 leading-tight">
      <span className="text-fg-subtle/70 shrink-0 tabular-nums">{time}</span>
      <span className="text-accent shrink-0 w-12">DIAL</span>
      <span className="text-fg shrink-0 w-36 tabular-nums">
        {intent.transformed_phone}
      </span>
      <span
        className={`shrink-0 w-24 ${TONE_CLASSES[state.tone]}`}
        title={state.detail ?? state.label}
      >
        {state.label}
      </span>
      {intent.assigned_username && (
        <span className="text-success shrink-0 w-32 truncate">
          → {intent.assigned_username}
        </span>
      )}
      <span className="text-fg-subtle text-xs">
        {intent.phone !== intent.transformed_phone && (
          <span className="mr-2">(was {intent.phone})</span>
        )}
        {intent.cid_used && (
          <span className="mr-2">cid {intent.cid_used}</span>
        )}
        {typeof intent.duration_ms === 'number' && intent.duration_ms > 0 && (
          <span className="mr-2 text-fg-subtle/70">
            {formatDuration(intent.duration_ms)}
          </span>
        )}
        {state.detail && state.detail !== state.label && (
          <span className="text-fg-subtle/70">{state.detail}</span>
        )}
      </span>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `${min}m` : `${min}m${rem}s`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return iso;
  }
}
