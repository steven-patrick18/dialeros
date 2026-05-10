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
  disposition: string | null;
  dispositioned_at: string | null;
  callback_at: string | null;
  recording_path: string | null;
}

const DISPOSITIONS: Array<{ code: string; label: string; tone: string }> = [
  { code: 'SALE', label: 'Sale', tone: 'text-success' },
  { code: 'CALLBACK', label: 'Callback', tone: 'text-warn' },
  { code: 'NO_INTEREST', label: 'No interest', tone: 'text-fg-muted' },
  { code: 'ANSWERING_MACHINE', label: 'Voicemail', tone: 'text-fg-muted' },
  { code: 'WRONG_NUMBER', label: 'Wrong #', tone: 'text-fg-muted' },
  { code: 'BAD_NUMBER', label: 'Bad #', tone: 'text-fg-muted' },
  { code: 'DNC', label: 'DNC', tone: 'text-error' },
];

export function AgentFeed({ initial }: { initial: AgentIntent[] }) {
  const [intents, setIntents] = useState<AgentIntent[]>(initial);
  const [connected, setConnected] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  async function dispose(intentId: number, code: string) {
    setBusyId(intentId);
    setError(null);
    let body: Record<string, unknown> = { disposition: code };
    if (code === 'CALLBACK') {
      // Default to +60 minutes — agent UI can refine later.
      body.callback_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    }
    try {
      const res = await fetch(`/api/agent/intents/${intentId}/dispose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `dispose failed (${res.status})`);
        return;
      }
      const j = (await res.json()) as { intent: AgentIntent };
      setIntents((prev) =>
        prev.map((p) => (p.id === intentId ? j.intent : p)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

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
        {error && (
          <span className="text-error truncate">{error}</span>
        )}
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-96 overflow-y-auto p-3 text-xs space-y-1 bg-card/70 border border-border rounded"
      >
        {intents.length === 0 ? (
          <div className="text-fg-subtle font-mono">
            No calls yet. When the pacer assigns one to you it&apos;ll appear
            here.
          </div>
        ) : (
          intents.map((i) => (
            <Row
              key={i.id}
              intent={i}
              busy={busyId === i.id}
              onDispose={(code) => dispose(i.id, code)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Row({
  intent,
  busy,
  onDispose,
}: {
  intent: AgentIntent;
  busy: boolean;
  onDispose: (code: string) => void;
}) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="border-b border-border/40 pb-1">
      <div className="flex gap-3 leading-tight font-mono">
        <span className="text-fg-subtle/70 shrink-0 tabular-nums">
          {formatTime(intent.ts)}
        </span>
        <span className="text-accent shrink-0 w-24 truncate">
          {intent.campaign_name}
        </span>
        <span className="text-fg shrink-0 w-32 tabular-nums">
          {intent.transformed_phone}
        </span>
        {intent.lead_name && (
          <span className="text-fg-muted shrink-0 w-24 truncate">
            {intent.lead_name}
          </span>
        )}
        <span className="text-fg-subtle/70">[{intent.kind}]</span>
        {intent.recording_path && (
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="text-accent hover:text-accent-hover text-[11px] uppercase tracking-wide"
            title="Play recording"
          >
            {playing ? '▣' : '▶'} rec
          </button>
        )}
      </div>
      {playing && intent.recording_path && (
        <div className="mt-1 ml-12">
          <audio
            src={`/api/recordings/${intent.id}`}
            controls
            preload="metadata"
            className="h-7 w-full max-w-md"
          />
        </div>
      )}
      <div className="flex flex-wrap gap-1 mt-1 ml-12">
        {intent.disposition ? (
          <span
            className={`text-[11px] uppercase tracking-wide ${toneFor(intent.disposition)}`}
          >
            ✓ {labelFor(intent.disposition)}
            {intent.callback_at && (
              <span className="text-fg-subtle ml-2 normal-case tracking-normal">
                callback {new Date(intent.callback_at).toLocaleString()}
              </span>
            )}
          </span>
        ) : (
          DISPOSITIONS.map((d) => (
            <button
              key={d.code}
              onClick={() => onDispose(d.code)}
              disabled={busy}
              className={`text-[11px] px-2 py-0.5 rounded border border-border hover:bg-card-hover disabled:opacity-50 ${d.tone}`}
            >
              {d.label}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function labelFor(code: string): string {
  return DISPOSITIONS.find((d) => d.code === code)?.label ?? code;
}

function toneFor(code: string): string {
  return DISPOSITIONS.find((d) => d.code === code)?.tone ?? 'text-fg';
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
