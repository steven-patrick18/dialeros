'use client';

import { useCallback, useEffect, useState } from 'react';

interface Build {
  version: string;
  commit: string;
  started_at: string;
}
interface Check {
  key: string;
  label: string;
  level: 'pass' | 'warn' | 'fail';
  detail: string;
}
interface Report {
  verdict: 'go' | 'no-go';
  checks: Check[];
  summary: { pass: number; warn: number; fail: number };
}

const TONE: Record<Check['level'], string> = {
  pass: 'text-success',
  warn: 'text-warn',
  fail: 'text-error',
};
const GLYPH: Record<Check['level'], string> = {
  pass: '✓',
  warn: '!',
  fail: '✕',
};

export function ReleaseCheckClient({ build }: { build: Build }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/release-check', {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { report: Report };
      setReport(data.report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {loading ? 'Checking…' : 'Re-run check'}
        </button>
        <span className="text-xs text-fg-subtle font-mono">
          build {build.commit} · up since{' '}
          {new Date(build.started_at).toLocaleString()}
        </span>
      </div>

      {error && <p className="text-error text-sm">{error}</p>}

      {report && (
        <>
          <div
            className={
              report.verdict === 'go'
                ? 'border border-success/40 bg-success/10 rounded p-4'
                : 'border border-error/40 bg-error/10 rounded p-4'
            }
          >
            <div className="text-lg font-semibold">
              {report.verdict === 'go' ? (
                <span className="text-success">● GO</span>
              ) : (
                <span className="text-error">● NO-GO</span>
              )}
            </div>
            <div className="text-xs text-fg-subtle mt-1">
              {report.summary.pass} pass · {report.summary.warn} warn ·{' '}
              {report.summary.fail} fail
            </div>
          </div>

          <table className="w-full text-sm border border-border rounded">
            <tbody>
              {report.checks.map((c) => (
                <tr key={c.key} className="border-t border-border">
                  <td className="px-3 py-2 w-8 text-center">
                    <span className={TONE[c.level]}>{GLYPH[c.level]}</span>
                  </td>
                  <td className="px-3 py-2 font-medium">{c.label}</td>
                  <td className="px-3 py-2 text-fg-subtle text-xs">
                    {c.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
