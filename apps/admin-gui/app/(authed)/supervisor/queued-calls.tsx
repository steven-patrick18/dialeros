'use client';

import { useEffect, useState } from 'react';

// Iter 116 — parked-callers view. Shows every caller currently
// holding for an agent (expired_at IS NULL) with hold time + the
// in-group + classification. Polls every 3s — hold-time creep
// reads correctly even when no new calls land.

interface QueuedCall {
  id: string;
  call_id: string;
  from_phone: string;
  to_phone: string;
  in_group_id: string;
  in_group_name: string;
  classification: string | null;
  enqueued_at: string;
  dispatched_at: string | null;
  dispatched_extension: string | null;
}

export function QueuedCalls({ initial }: { initial: QueuedCall[] }) {
  const [rows, setRows] = useState<QueuedCall[]>(initial);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/supervisor/queued-calls', {
          cache: 'no-store',
        });
        if (r.ok) {
          const j = (await r.json()) as { calls: QueuedCall[] };
          setRows(j.calls);
        }
      } catch {
        /* offline — keep last */
      }
      setTick((t) => t + 1);
    }, 3_000);
    return () => clearInterval(id);
  }, []);

  // Re-render the elapsed timer column independently so it ticks
  // even between fetches (3s is OK but 1s feels right for a hold
  // clock the supervisor is staring at).
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const waiting = rows.filter((r) => !r.dispatched_at).length;
  const ringing = rows.filter((r) => r.dispatched_at).length;

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between mb-3 max-w-5xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          Parked callers
        </h2>
        <span className="text-xs text-fg-subtle">
          <span className="text-warn">{waiting} waiting</span>
          {' · '}
          <span className="text-info">{ringing} ringing agent</span>
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No callers in queue. When all agents in an in-group are busy
          or paused, new inbound callers land here until an agent frees up.
        </p>
      ) : (
        <div className="border border-border rounded overflow-hidden max-w-5xl">
          <table className="w-full text-sm">
            <thead className="text-left text-fg-subtle border-b border-border bg-card-hover/30">
              <tr>
                <th className="py-2 px-3 font-medium">Held for</th>
                <th className="font-medium">From</th>
                <th className="font-medium">DID</th>
                <th className="font-medium">In-group</th>
                <th className="font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const heldMs = Date.now() - Date.parse(r.enqueued_at);
                const ringing = r.dispatched_at != null;
                const heldSec = Math.floor(heldMs / 1000);
                const heldTone =
                  heldSec >= 120
                    ? 'text-error'
                    : heldSec >= 60
                      ? 'text-warn'
                      : 'text-fg';
                return (
                  <tr
                    key={r.id}
                    className="border-b border-border/40"
                    data-tick={tick}
                  >
                    <td
                      className={`py-2 px-3 font-mono tabular-nums ${heldTone}`}
                    >
                      {formatHeld(heldSec)}
                    </td>
                    <td className="font-mono text-xs">{r.from_phone}</td>
                    <td className="font-mono text-xs text-fg-muted">
                      {r.to_phone}
                    </td>
                    <td className="text-fg-muted">{r.in_group_name}</td>
                    <td>
                      {ringing ? (
                        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border bg-info/15 text-info border-info/40">
                          ringing ext {r.dispatched_extension ?? '—'}
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border bg-warn/15 text-warn border-warn/40">
                          on hold
                          {r.classification && (
                            <span className="ml-1 normal-case tracking-normal">
                              · {r.classification}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatHeld(sec: number): string {
  if (sec < 60) return `0:${String(sec).padStart(2, '0')}`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
