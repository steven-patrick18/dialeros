'use client';

import { useEffect, useRef, useState } from 'react';

interface AgentIntent {
  id: number;
  ts: string;
  campaign_id: string;
  campaign_name: string;
  lead_id: string;
  lead_name: string | null;
  phone: string;
  transformed_phone: string;
  cid_used: string | null;
  kind: string;
}

export function AgentFeed({ initial }: { initial: AgentIntent[] }) {
  const [intents, setIntents] = useState<AgentIntent[]>(initial);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    const es = new EventSource('/api/agent/intents/events');
    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'intent') {
          setIntents((prev) => {
            // de-dupe on id (replay overlap with initial SSR fetch)
            if (prev.some((p) => p.id === data.intent.id)) return prev;
            return [...prev, data.intent].slice(-200);
          });
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

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
      <div className="flex items-center gap-3 mb-3 text-xs">
        {connected ? (
          <span className="text-success">● live</span>
        ) : (
          <span className="text-fg-subtle">○ reconnecting…</span>
        )}
        <span className="text-fg-subtle tabular-nums">
          {intents.length} shown
        </span>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-80 overflow-y-auto p-3 font-mono text-xs space-y-0.5 bg-card/70 border border-border rounded"
      >
        {intents.length === 0 ? (
          <div className="text-fg-subtle">
            No calls yet. When the pacer assigns one to you it&apos;ll appear
            here.
          </div>
        ) : (
          intents.map((i) => <Row key={i.id} intent={i} />)
        )}
      </div>
    </div>
  );
}

function Row({ intent }: { intent: AgentIntent }) {
  return (
    <div className="flex gap-3 leading-tight">
      <span className="text-fg-subtle/70 shrink-0 tabular-nums">
        {formatTime(intent.ts)}
      </span>
      <span className="text-accent shrink-0 w-16 truncate">
        {intent.campaign_name}
      </span>
      <span className="text-fg shrink-0 w-32 tabular-nums">
        {intent.transformed_phone}
      </span>
      {intent.lead_name && (
        <span className="text-fg-muted shrink-0 w-28 truncate">
          {intent.lead_name}
        </span>
      )}
      <span className="text-fg-subtle/70 text-xs">[{intent.kind}]</span>
    </div>
  );
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
