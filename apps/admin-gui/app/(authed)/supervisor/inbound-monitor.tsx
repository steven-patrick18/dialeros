'use client';

import { useEffect, useState } from 'react';

// Iter 115 — supervisor inbound monitor. Shows the last 50
// inbound routing decisions Kamailio asked us to make: who
// called, what DID they hit, what we decided (forward / queue /
// reject), classification (DID match / iter-107 whitelist /
// queue reason), and which agent we sent them to. Polled every
// 5s — inbound decisions are frequent enough that a 10s window
// feels sluggish, but cheap enough that 5s isn't a burden.

interface InboundDecision {
  ts: string;
  action: string;
  target_in_group_id: string | null;
  from_phone: string | null;
  to_phone: string | null;
  classification: string | null;
  agent_extension: string | null;
  lead_id: string | null;
}

export function InboundMonitor({
  initial,
}: {
  initial: InboundDecision[];
}) {
  const [rows, setRows] = useState<InboundDecision[]>(initial);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/supervisor/inbound-decisions', {
          cache: 'no-store',
        });
        if (r.ok) {
          const j = (await r.json()) as { decisions: InboundDecision[] };
          setRows(j.decisions);
        }
      } catch {
        /* offline blip — keep last */
      }
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  const forwarded = rows.filter((r) => r.action === 'inbound.forwarded').length;
  const queued = rows.filter((r) => r.action === 'inbound.queued').length;

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between mb-3 max-w-5xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          Inbound — last {rows.length} decisions
        </h2>
        <span className="text-xs text-fg-subtle">
          <span className="text-success">{forwarded} forwarded</span>
          {' · '}
          <span className="text-warn">{queued} queued</span>
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No inbound calls yet. Kamailio sends a routing decision
          request on every PSTN INVITE; once the inbound trunk is
          wired this view fills up in real time.
        </p>
      ) : (
        <div className="border border-border rounded overflow-hidden max-w-5xl">
          <table className="w-full text-sm">
            <thead className="text-left text-fg-subtle border-b border-border bg-card-hover/30">
              <tr>
                <th className="py-2 px-3 font-medium">When</th>
                <th className="font-medium">From</th>
                <th className="font-medium">DID dialed</th>
                <th className="font-medium">Outcome</th>
                <th className="font-medium">Classification</th>
                <th className="font-medium">Agent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const isFwd = r.action === 'inbound.forwarded';
                return (
                  <tr
                    key={`${r.ts}-${i}`}
                    className="border-b border-border/40"
                  >
                    <td className="py-2 px-3 text-fg-subtle text-xs whitespace-nowrap">
                      {formatRel(r.ts)}
                    </td>
                    <td className="font-mono text-xs">
                      {r.from_phone ?? <span className="text-fg-subtle">—</span>}
                      {r.lead_id && (
                        <span className="text-accent text-[10px] ml-2 uppercase tracking-wide">
                          ↩ return
                        </span>
                      )}
                    </td>
                    <td className="font-mono text-xs text-fg-muted">
                      {r.to_phone ?? '—'}
                    </td>
                    <td>
                      <span
                        className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded border ${
                          isFwd
                            ? 'bg-success/15 text-success border-success/50'
                            : 'bg-warn/15 text-warn border-warn/40'
                        }`}
                      >
                        {isFwd ? 'forwarded' : 'queued'}
                      </span>
                    </td>
                    <td className="text-fg-subtle text-xs font-mono">
                      {r.classification ?? '—'}
                    </td>
                    <td className="font-mono text-xs">
                      {r.agent_extension ? (
                        <span className="text-fg">ext {r.agent_extension}</span>
                      ) : (
                        <span className="text-fg-subtle">none</span>
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

function formatRel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return new Date(iso).toLocaleString();
}
