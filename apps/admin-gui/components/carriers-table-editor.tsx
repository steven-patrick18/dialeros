'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface CarrierOption {
  id: string;
  name: string;
  host: string;
  enabled: boolean;
}

export interface CarrierRow {
  carrier_id: string;
  priority: number;
  ports: number;
}

/**
 * Iter 74 — table editor for the (route_plan, carrier) join. Same
 * priority across multiple rows = round-robin within that tier
 * (so [1, 1] = 50/50 split). Lower priority dials first; higher
 * priorities only used when the lower tier exhausts (no capacity,
 * no prefix match, etc.). Ports caps concurrent in-flight calls per
 * carrier on this route plan.
 *
 * Submit modes:
 *  - mode='inline'    — POSTs PUT /api/route-plans/{planId}/carriers
 *                       on save and refreshes server state. Used on
 *                       the route plan detail page.
 *  - mode='controlled' — invokes onChange every keystroke and renders
 *                       no save button. Used inside the route plan
 *                       add form so the parent submits everything in
 *                       one POST.
 */
export function CarriersTableEditor({
  planId,
  carriers,
  initialRows,
  mode = 'inline',
  onChange,
}: {
  /** Required when mode='inline'. */
  planId?: string;
  /** All carriers available to attach. */
  carriers: CarrierOption[];
  initialRows: CarrierRow[];
  mode?: 'inline' | 'controlled';
  /** Only used when mode='controlled'. */
  onChange?: (rows: CarrierRow[]) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<CarrierRow[]>(initialRows);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const carrierById = useMemo(
    () => new Map(carriers.map((c) => [c.id, c])),
    [carriers],
  );
  const usedIds = useMemo(() => new Set(rows.map((r) => r.carrier_id)), [rows]);
  const available = useMemo(
    () => carriers.filter((c) => !usedIds.has(c.id)),
    [carriers, usedIds],
  );

  function update(next: CarrierRow[]) {
    setRows(next);
    setMsg(null);
    if (mode === 'controlled') onChange?.(next);
  }

  function addRow(carrierId: string) {
    const maxPri = rows.reduce((m, r) => Math.max(m, r.priority), 0);
    update([
      ...rows,
      { carrier_id: carrierId, priority: Math.max(1, maxPri), ports: 30 },
    ]);
  }

  function removeRow(idx: number) {
    update(rows.filter((_, i) => i !== idx));
  }

  function patchRow(idx: number, patch: Partial<CarrierRow>) {
    update(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (mode !== 'inline' || !planId) return;
    if (rows.length === 0) {
      setMsg({ tone: 'err', text: 'At least one carrier is required.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/route-plans/${planId}/carriers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ carriers: rows }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `Save failed (${res.status})` });
      return;
    }
    setMsg({ tone: 'ok', text: 'Saved.' });
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-fg-subtle text-sm italic">
          No carriers attached yet — add one below.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-fg-subtle border-b border-border">
            <tr>
              <th className="py-2 font-medium">Carrier</th>
              <th className="font-medium w-24">Priority</th>
              <th className="font-medium w-24">Ports</th>
              <th className="font-medium w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => {
              const c = carrierById.get(r.carrier_id);
              return (
                <tr key={r.carrier_id} className="border-b border-border/50">
                  <td className="py-2">
                    {c ? (
                      <>
                        <span>{c.name}</span>
                        <span className="text-fg-subtle text-xs ml-2 font-mono">
                          {c.host}
                        </span>
                        {!c.enabled && (
                          <span className="ml-2 text-xs text-warn">
                            (disabled)
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-error text-xs">missing</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={r.priority}
                      onChange={(e) =>
                        patchRow(idx, {
                          priority: Math.max(
                            1,
                            Math.min(99, Number(e.target.value) || 1),
                          ),
                        })
                      }
                      className="input text-sm w-20 tabular-nums"
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      max={9999}
                      value={r.ports}
                      onChange={(e) =>
                        patchRow(idx, {
                          ports: Math.max(
                            1,
                            Math.min(9999, Number(e.target.value) || 1),
                          ),
                        })
                      }
                      className="input text-sm w-20 tabular-nums"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="text-xs px-2 py-1 rounded border border-border text-fg-muted hover:text-error hover:border-error/50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {available.length > 0 && (
        <div>
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) addRow(e.target.value);
              e.target.value = '';
            }}
            className="input text-sm"
          >
            <option value="">+ Add carrier…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.enabled ? '' : '(disabled)'}
              </option>
            ))}
          </select>
        </div>
      )}

      <p className="text-xs text-fg-subtle">
        Same priority across multiple rows = round-robin within that tier
        (e.g. <span className="font-mono">1, 1</span> = 50/50 split). Lower
        priority dials first; the pacer escalates to higher priorities only
        when the lower tier exhausts (port cap reached, or no carrier
        accepts this destination&apos;s prefix). Ports caps concurrent
        in-flight calls per carrier across the whole dialer.
      </p>

      {mode === 'inline' && (
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={save}
            disabled={busy || rows.length === 0}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save carriers'}
          </button>
          {msg && (
            <span
              className={`text-xs ${
                msg.tone === 'ok' ? 'text-success' : 'text-error'
              }`}
            >
              {msg.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
