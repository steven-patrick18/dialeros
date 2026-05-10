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
  hangup_cause: string | null;
  duration_ms: number | null;
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
  const [intents, setIntents] = useState<DialIntent[]>([]);
  const [connected, setConnected] = useState(false);
  const [total, setTotal] = useState(initialTotal);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    const es = new EventSource(`/api/campaigns/${campaignId}/intents/events`);
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'intent') {
          setIntents((prev) => {
            const next = [...prev, data.intent].slice(-200);
            return next;
          });
          setTotal((t) => t + 1);
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
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
      <div className="flex items-center justify-between mb-3">
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
        <span className="text-xs text-fg-subtle tabular-nums">
          {total.toLocaleString()} dial intents total
        </span>
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
              : 'Pacer is idle. Flip status to ACTIVE to start the simulation.'}
          </div>
        ) : (
          intents.map((i) => <IntentLine key={i.id} intent={i} />)
        )}
        {isActive && (
          <div className="text-fg-subtle animate-pulse">▌</div>
        )}
      </div>

      <p className="text-xs text-fg-subtle mt-3">
        v1 simulation — intents are recorded + leads marked CALLED_NO_ANSWER,
        but no real SIP origination happens yet. Wires to FreeSWITCH ESL when
        the telephony layer lands.
      </p>
    </div>
  );
}

function IntentLine({ intent }: { intent: DialIntent }) {
  const time = formatTime(intent.ts);
  return (
    <div className="flex gap-3 leading-tight">
      <span className="text-fg-subtle/70 shrink-0 tabular-nums">{time}</span>
      <span className="text-accent shrink-0 w-12">DIAL</span>
      <span className="text-fg shrink-0 w-36 tabular-nums">
        {intent.transformed_phone}
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
        {intent.cid_used && <span className="mr-2">cid {intent.cid_used}</span>}
        <span className="text-fg-subtle/70">[{intent.kind}]</span>
        {intent.hangup_cause && (
          <span className={`ml-2 ${hangupColor(intent.hangup_cause)}`}>
            {intent.hangup_cause}
            {typeof intent.duration_ms === 'number' && intent.duration_ms > 0 && (
              <span className="text-fg-subtle/70 ml-1">
                ({formatDuration(intent.duration_ms)})
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

function hangupColor(cause: string): string {
  if (cause === 'NORMAL_CLEARING') return 'text-success';
  if (cause === 'USER_BUSY' || cause === 'NO_ANSWER' || cause === 'NO_USER_RESPONSE') {
    return 'text-warn';
  }
  if (cause === 'ORIGINATOR_CANCEL') return 'text-fg-muted';
  return 'text-error';
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
