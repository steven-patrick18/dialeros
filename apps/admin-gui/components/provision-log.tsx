'use client';

import { useEffect, useRef, useState } from 'react';

type Level = 'INFO' | 'WARN' | 'ERROR' | 'PHASE';

interface LogEntry {
  ts: string;
  level: Level;
  phase: string;
  message: string;
}

type Status = 'PROVISIONING' | 'READY' | 'FAILED';

export function ProvisionLog({
  nodeId,
  initialStatus,
  initialError,
}: {
  nodeId: string;
  initialStatus: Status;
  initialError: string | null;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<Status>(initialStatus);
  const [errorMessage, setErrorMessage] = useState<string | null>(initialError);
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    const es = new EventSource(`/api/nodes/${nodeId}/events`);

    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'log') {
          setLogs((prev) => [...prev, data]);
        } else if (data.type === 'status') {
          setStatus(data.status as Status);
          setErrorMessage(data.error_message ?? null);
        }
      } catch {
        /* ignore parse errors */
      }
    };
    es.onerror = () => setConnected(false);

    return () => es.close();
  }, [nodeId]);

  // Auto-scroll to bottom on new log unless the user scrolled up manually.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!userScrolledRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    userScrolledRef.current = !atBottom;
  };

  return (
    <div className="border border-border rounded max-w-3xl">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase text-fg-subtle">Status</span>
          <StatusLabel status={status} />
          {!connected && (
            <span className="text-xs text-fg-subtle">(reconnectingâ€¦)</span>
          )}
        </div>
        <span className="text-xs text-fg-subtle">{logs.length} events</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-72 overflow-y-auto p-3 font-mono text-xs space-y-0.5 bg-card/70"
      >
        {logs.length === 0 && (
          <div className="text-fg-subtle">Waiting for eventsâ€¦</div>
        )}
        {logs.map((log, i) => (
          <LogLine key={i} log={log} />
        ))}
        {status === 'PROVISIONING' && (
          <div className="text-fg-subtle animate-pulse">â–Œ</div>
        )}
      </div>

      {status === 'FAILED' && errorMessage && (
        <div className="border-t border-border px-4 py-2 text-xs text-error">
          {errorMessage}
        </div>
      )}
    </div>
  );
}

function StatusLabel({ status }: { status: Status }) {
  const styles: Record<Status, string> = {
    PROVISIONING: 'text-warn',
    READY: 'text-success',
    FAILED: 'text-error',
  };
  return <span className={`text-sm ${styles[status]}`}>{status}</span>;
}

function LogLine({ log }: { log: LogEntry }) {
  const colors: Record<Level, string> = {
    INFO: 'text-fg-muted',
    PHASE: 'text-accent',
    WARN: 'text-warn',
    ERROR: 'text-error',
  };
  const time = formatTime(log.ts);
  return (
    <div className="flex gap-3 leading-tight">
      <span className="text-fg-subtle shrink-0 tabular-nums">{time}</span>
      <span className={`shrink-0 w-12 ${colors[log.level]}`}>{log.level}</span>
      <span className="text-fg-subtle shrink-0 w-44 truncate">{log.phase}</span>
      <span className={colors[log.level]}>{log.message}</span>
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
