'use client';

import { useCallback, useEffect, useState } from 'react';

interface Item {
  key: string;
  label: string;
  status: 'ok' | 'blocked' | 'warn';
  detail: string;
  remediation: string;
  required: boolean;
}
interface Report {
  armed: boolean;
  live: boolean;
  blockers: number;
  warnings: number;
  summary: string;
  items: Item[];
}

const DOT: Record<Item['status'], string> = {
  ok: 'text-success',
  blocked: 'text-error',
  warn: 'text-warn',
};
const GLYPH: Record<Item['status'], string> = {
  ok: '\u25cf',
  blocked: '\u2715',
  warn: '\u25cb',
};

export function ReadinessPanel() {
  const [rep, setRep] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch('/api/ai/readiness', {
        credentials: 'same-origin',
      });
      if (!r.ok) {
        setErr(`HTTP ${r.status}`);
        return;
      }
      setRep((await r.json()) as Report);
    } catch {
      setErr('probe failed');
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const bannerCls = !rep
    ? 'bg-bg'
    : rep.armed
      ? rep.live
        ? 'bg-success/10 border-success/40'
        : 'bg-warn/10 border-warn/40'
      : 'bg-error/10 border-error/40';

  return (
    <div className="border border-border rounded p-4 bg-card mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          AI readiness preflight
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="text-xs border border-border rounded px-2 py-1 disabled:opacity-50"
        >
          {busy ? 'Probing…' : 'Re-check'}
        </button>
      </div>
      {err && <p className="text-xs text-error">{err}</p>}
      {rep && (
        <>
          <div
            className={`border rounded px-3 py-2 text-sm ${bannerCls}`}
          >
            {rep.summary}
          </div>
          <ul className="space-y-1.5">
            {rep.items.map((it) => (
              <li key={it.key} className="text-xs flex gap-2">
                <span className={`${DOT[it.status]} mt-0.5`}>
                  {GLYPH[it.status]}
                </span>
                <span className="flex-1">
                  <span className="font-medium">{it.label}</span>
                  {!it.required && (
                    <span className="text-fg-subtle">
                      {' '}
                      (optional)
                    </span>
                  )}
                  <span className="text-fg-subtle">
                    {' '}
                    — {it.detail}
                  </span>
                  {it.status !== 'ok' && it.remediation && (
                    <span className="block text-fg-subtle mt-0.5">
                      → {it.remediation}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
