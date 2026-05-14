'use client';

import { useCallback, useEffect, useState } from 'react';

interface Row {
  id: number;
  call_id: string;
  in_group_id: string;
  in_group_name: string | null;
  from_phone: string;
  to_phone: string | null;
  requested_at: string;
  status: string;
  attempts: number;
  dispatched_at: string | null;
  completed_at: string | null;
  expire_reason: string | null;
  notes: string | null;
}

interface Props {
  initialRows: Row[];
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function statusTone(s: string): string {
  if (s === 'pending') return 'text-warn';
  if (s === 'dispatched') return 'text-link';
  if (s === 'completed') return 'text-success';
  if (s === 'failed') return 'text-error';
  return 'text-fg-muted';
}

export function CallbacksList({ initialRows }: Props) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/supervisor/callbacks', {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { rows: Row[] };
      setRows(data.rows);
    } catch {
      // soft fail — keep stale rows
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  async function cancel(id: number) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(
        `/api/supervisor/callbacks/${id}/cancel`,
        { method: 'POST', credentials: 'same-origin' },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-fg-subtle">
        No callback requests yet. When enabled, callers who press
        the configured DTMF while on hold will show up here.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <p className="text-error text-xs">{error}</p> : null}
      <table className="w-full text-sm border border-border rounded">
        <thead className="bg-card">
          <tr className="text-left">
            <th className="px-3 py-2">Requested</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">From</th>
            <th className="px-3 py-2">To (DID)</th>
            <th className="px-3 py-2">In-Group</th>
            <th className="px-3 py-2">Attempts</th>
            <th className="px-3 py-2">Notes</th>
            <th className="px-3 py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-3 py-2 whitespace-nowrap">
                {fmtTime(r.requested_at)}
              </td>
              <td className={`px-3 py-2 ${statusTone(r.status)}`}>
                {r.status}
              </td>
              <td className="px-3 py-2">{r.from_phone}</td>
              <td className="px-3 py-2">{r.to_phone ?? '—'}</td>
              <td className="px-3 py-2">
                {r.in_group_name ?? r.in_group_id}
              </td>
              <td className="px-3 py-2 text-center">{r.attempts}</td>
              <td className="px-3 py-2 text-fg-subtle text-xs">
                {r.expire_reason ?? r.notes ?? ''}
              </td>
              <td className="px-3 py-2">
                {r.status === 'pending' || r.status === 'dispatched' ? (
                  <button
                    type="button"
                    onClick={() => void cancel(r.id)}
                    disabled={busyId === r.id}
                    className="text-error hover:underline text-xs"
                  >
                    Cancel
                  </button>
                ) : (
                  <span className="text-fg-muted text-xs">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-fg-subtle">
        Auto-refresh every 10s.
      </p>
    </div>
  );
}
