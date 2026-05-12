'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface DncRow {
  phone: string;
  reason: string | null;
  added_at: string;
  added_by_user_id: string | null;
}

interface LookupResult {
  listed: boolean;
  phone?: string;
  reason?: string | null;
  added_at?: string;
  added_by_user_id?: string | null;
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
  // Iter 106 — single-number lookup card + table filter. The
  // operator's #1 question is "is this number on DNC?" — answering
  // it required scrolling through the table or trusting the pacer
  // to refuse a dial. Now it's a paste-and-click answer.
  const [lookupInput, setLookupInput] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [filter, setFilter] = useState('');

  async function checkLookup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!lookupInput.trim()) return;
    setLookupBusy(true);
    setLookupResult(null);
    try {
      const res = await fetch(
        `/api/dnc/${encodeURIComponent(lookupInput.trim())}`,
        { cache: 'no-store' },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setLookupResult({ listed: false });
        setMsg({
          tone: 'err',
          text: j.error ?? `lookup failed (${res.status})`,
        });
        return;
      }
      const j = (await res.json()) as LookupResult;
      setLookupResult(j);
    } finally {
      setLookupBusy(false);
    }
  }

  // Table filter — case-insensitive digit-string match. The DNC
  // table stores normalised phones (digits-only / canonical) so a
  // partial digit match is enough.
  const filterDigits = filter.replace(/\D/g, '');
  const visible = filterDigits
    ? rows.filter((r) => r.phone.includes(filterDigits))
    : rows;

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
      {/* Iter 106 — lookup card. The operator's most-asked question
          gets a paste-and-click answer instead of a table scroll. */}
      <form
        onSubmit={checkLookup}
        className="border border-border rounded p-4 max-w-4xl"
      >
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Check DNC status
        </h2>
        <div className="flex flex-col md:flex-row gap-3 md:items-end">
          <label className="flex-1">
            <div className="text-xs text-fg-subtle mb-1">
              Phone — any format
            </div>
            <input
              value={lookupInput}
              onChange={(e) => setLookupInput(e.target.value)}
              minLength={4}
              maxLength={40}
              placeholder="+1 (202) 555-0123"
              className="input"
            />
          </label>
          <button
            type="submit"
            disabled={lookupBusy || !lookupInput.trim()}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-50 md:w-32"
          >
            {lookupBusy ? 'Checking…' : 'Check'}
          </button>
        </div>
        {lookupResult && lookupResult.listed && (
          <div className="mt-3 rounded border border-error/50 bg-error/10 px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-error font-medium">
                ON the DNC list
              </span>
              <span className="text-fg-subtle text-xs font-mono">
                {lookupResult.phone}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
              <div>
                <dt className="text-fg-subtle uppercase">Reason</dt>
                <dd className="text-fg">
                  {lookupResult.reason ?? (
                    <span className="text-fg-subtle">—</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-fg-subtle uppercase">Added</dt>
                <dd className="text-fg">
                  {lookupResult.added_at
                    ? new Date(lookupResult.added_at).toLocaleString()
                    : '—'}
                </dd>
              </div>
            </div>
          </div>
        )}
        {lookupResult && !lookupResult.listed && (
          <p className="mt-3 rounded border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
            Not on DNC — safe to dial.
          </p>
        )}
      </form>

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
        <div className="flex items-end justify-between mb-2 max-w-4xl">
          <h2 className="text-sm font-medium">
            DNC list ({count.toLocaleString()} number{count === 1 ? '' : 's'})
            {filterDigits && rows.length !== visible.length && (
              <span className="text-fg-subtle font-normal ml-2 text-xs">
                · showing {visible.length.toLocaleString()}
              </span>
            )}
          </h2>
          {/* Iter 106 — quick filter against the loaded page of rows.
              Matches digits anywhere in the stored canonical phone. */}
          <label className="flex items-center gap-2 text-xs">
            <span className="text-fg-subtle">Filter</span>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="digits to match"
              className="input w-44 text-xs"
            />
            {filter.length > 0 && (
              <button
                type="button"
                onClick={() => setFilter('')}
                className="text-fg-subtle hover:text-fg"
                title="Clear filter"
              >
                ×
              </button>
            )}
          </label>
        </div>
        {rows.length === 0 ? (
          <p className="text-fg-subtle text-sm">No numbers on the DNC list.</p>
        ) : visible.length === 0 ? (
          <p className="text-fg-subtle text-sm">
            No matches for &ldquo;{filter}&rdquo; in the loaded rows.
          </p>
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
              {visible.map((r) => (
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
