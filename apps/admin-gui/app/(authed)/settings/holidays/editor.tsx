'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Row {
  id: number;
  holiday_date: string;
  name: string;
  enabled: number;
  created_at: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function HolidaysEditor({ initialRows }: { initialRows: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (!DATE_RE.test(newDate.trim())) {
      setError('Date must be YYYY-MM-DD');
      return;
    }
    if (!newName.trim()) {
      setError('Name required');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          holiday_date: newDate.trim(),
          name: newName.trim(),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { row: Row };
      setRows((prev) => {
        const without = prev.filter((r) => r.id !== data.row.id);
        return [...without, data.row].sort((a, b) =>
          a.holiday_date < b.holiday_date ? -1 : 1,
        );
      });
      setNewDate('');
      setNewName('');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(r: Row) {
    setError(null);
    const next = r.enabled ? 0 : 1;
    const res = await fetch(`/api/holidays/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ enabled: Boolean(next) }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    setRows((prev) =>
      prev.map((x) => (x.id === r.id ? { ...x, enabled: next } : x)),
    );
  }

  async function remove(id: number) {
    setError(null);
    const res = await fetch(`/api/holidays/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    setRows((prev) => prev.filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded p-4 bg-card">
        <h2 className="text-sm font-semibold mb-3">Add holiday</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-fg-subtle mb-1">
              Date (YYYY-MM-DD)
            </label>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="border border-border rounded bg-bg px-2 py-1 text-sm"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-fg-subtle mb-1">Name</label>
            <input
              type="text"
              placeholder="Memorial Day"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full border border-border rounded bg-bg px-2 py-1 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy}
            className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {error ? <p className="text-error text-xs mt-2">{error}</p> : null}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          No holidays yet. Add one above; it&apos;ll force after-hours
          routing on that date for every in-group.
        </p>
      ) : (
        <table className="w-full text-sm border border-border rounded">
          <thead className="bg-card">
            <tr className="text-left">
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono">{r.holiday_date}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={!!r.enabled}
                      onChange={() => void toggleEnabled(r)}
                      className="h-4 w-4"
                    />
                    <span className={r.enabled ? 'text-success text-xs' : 'text-fg-muted text-xs'}>
                      {r.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </label>
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => void remove(r.id)}
                    className="text-error hover:underline text-xs"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
