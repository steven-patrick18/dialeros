'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DncRow {
  phone: string;
  reason: string | null;
  added_at: string;
  added_by_user_id: string | null;
}

export function DncManager({
  total,
  initial,
}: {
  total: number;
  initial: DncRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<DncRow[]>(initial);
  const [count, setCount] = useState(total);
  const [single, setSingle] = useState('');
  const [singleReason, setSingleReason] = useState('');
  const [bulk, setBulk] = useState('');
  const [bulkReason, setBulkReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  async function addOne(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/dnc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: single,
        reason: singleReason || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `failed (${res.status})` });
      return;
    }
    setSingle('');
    setSingleReason('');
    setMsg({ tone: 'ok', text: 'Added to DNC.' });
    router.refresh();
  }

  async function addBulk() {
    const lines = bulk
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (lines.length === 0) {
      setMsg({ tone: 'err', text: 'Paste at least one number.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/dnc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phones: lines,
        reason: bulkReason || undefined,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `failed (${res.status})` });
      return;
    }
    const j = (await res.json()) as { added: number; skipped: number };
    setBulk('');
    setBulkReason('');
    setMsg({
      tone: 'ok',
      text: `Added ${j.added} number(s); skipped ${j.skipped} (invalid format).`,
    });
    router.refresh();
  }

  async function remove(phone: string) {
    if (!confirm(`Remove ${phone} from the DNC list?`)) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/dnc/${encodeURIComponent(phone)}`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `failed (${res.status})` });
      return;
    }
    setRows((prev) => prev.filter((r) => r.phone !== phone));
    setCount((c) => c - 1);
    setMsg({ tone: 'ok', text: `${phone} removed.` });
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        <form
          onSubmit={addOne}
          className="border border-border rounded p-4"
        >
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
            Add one
          </h2>
          <label className="block mb-3">
            <div className="text-xs text-fg-subtle mb-1">Phone</div>
            <input
              value={single}
              onChange={(e) => setSingle(e.target.value)}
              required
              minLength={4}
              maxLength={40}
              placeholder="+1 (202) 555-0123"
              className="input"
            />
          </label>
          <label className="block mb-3">
            <div className="text-xs text-fg-subtle mb-1">Reason (optional)</div>
            <input
              value={singleReason}
              onChange={(e) => setSingleReason(e.target.value)}
              maxLength={200}
              placeholder="opt-out / litigator / wrong number"
              className="input"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add to DNC'}
          </button>
        </form>

        <div className="border border-border rounded p-4">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
            Bulk import
          </h2>
          <p className="text-xs text-fg-subtle mb-2">
            One phone per line. Any format — they get normalised on save.
          </p>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            rows={5}
            placeholder={'+12025550123\n202-555-0124\n(202) 555 0125'}
            className="input mb-3 font-mono text-xs"
          />
          <label className="block mb-3">
            <div className="text-xs text-fg-subtle mb-1">Reason (optional)</div>
            <input
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              maxLength={200}
              placeholder="e.g. external DNC scrub 2026-05"
              className="input"
            />
          </label>
          <button
            type="button"
            onClick={addBulk}
            disabled={busy || bulk.trim().length === 0}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {busy ? 'Importing…' : 'Import to DNC'}
          </button>
        </div>
      </div>

      {msg && (
        <div
          className={`text-sm ${
            msg.tone === 'ok' ? 'text-success' : 'text-error'
          }`}
        >
          {msg.text}
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium mb-2">
          DNC list ({count.toLocaleString()} number{count === 1 ? '' : 's'})
        </h2>
        {rows.length === 0 ? (
          <p className="text-fg-subtle text-sm">No numbers on the DNC list.</p>
        ) : (
          <table className="w-full text-sm max-w-4xl">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-2 font-medium">Phone</th>
                <th className="font-medium">Reason</th>
                <th className="font-medium">Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.phone} className="border-b border-border/40">
                  <td className="py-2 font-mono text-fg">{r.phone}</td>
                  <td className="text-fg-muted text-xs">
                    {r.reason ?? <span className="text-fg-subtle">—</span>}
                  </td>
                  <td className="text-fg-subtle text-xs">
                    {new Date(r.added_at).toLocaleString()}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      onClick={() => remove(r.phone)}
                      className="text-xs px-2 py-1 rounded border border-error/40 text-error hover:bg-error/10"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
