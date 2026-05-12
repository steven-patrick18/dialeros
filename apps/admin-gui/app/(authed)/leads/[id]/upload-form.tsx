'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface IngestResult {
  parsed: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  // Iter 127 — DNC scrub + per-row dupe/DNC samples.
  dnc_scrubbed: number;
  duplicate_phones: string[];
  dnc_phones: string[];
  rejections: Array<{ row: number; reason: string }>;
}

export function UploadCsvForm({ listId }: { listId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  // Iter 127 — default on. Operator can opt out for the "re-
  // import a previous export" case where the original list
  // intentionally included DNC phones we want to keep tracking.
  const [scrubDnc, setScrubDnc] = useState(true);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError(null);
    setResult(null);

    const fd = new FormData();
    fd.append('file', file);
    fd.append('scrub_dnc', scrubDnc ? '1' : '0');

    const res = await fetch(`/api/lead-lists/${listId}/leads`, {
      method: 'POST',
      body: fd,
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      setError(err.error ?? `Upload failed (${res.status})`);
      setSubmitting(false);
      return;
    }
    const data = (await res.json()) as IngestResult;
    setResult(data);
    setSubmitting(false);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <p className="text-xs text-fg-subtle">
        Expected columns: <span className="font-mono">phone</span> (required),{' '}
        <span className="font-mono">name</span> and{' '}
        <span className="font-mono">email</span> (optional). First row may be
        headers — auto-detected.
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-fg-muted file:mr-3 file:py-1.5 file:px-3 file:border-0 file:rounded file:bg-accent file:text-accent-fg file:cursor-pointer hover:file:bg-accent-hover"
      />

      {/* Iter 127 — DNC scrub toggle. Default ON; flagged warn-toned
          when off so an operator notices they're bypassing TCPA
          protection. */}
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={scrubDnc}
          onChange={(e) => setScrubDnc(e.target.checked)}
        />
        <span className={scrubDnc ? 'text-fg-muted' : 'text-warn'}>
          Skip phones on the Do Not Call list
          {!scrubDnc && (
            <span className="text-warn font-medium ml-1">
              (OFF — TCPA risk)
            </span>
          )}
        </span>
      </label>

      {error && (
        <div className="border border-error/50 bg-error/10 text-error text-sm rounded p-2">
          {error}
        </div>
      )}

      {result && (
        <div className="border border-border rounded p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-fg-subtle">Parsed</span>
            <span className="tabular-nums">{result.parsed}</span>
          </div>
          <div className="flex justify-between text-success">
            <span>Inserted</span>
            <span className="tabular-nums">{result.inserted}</span>
          </div>
          {result.duplicates > 0 && (
            <div className="flex justify-between text-warn">
              <span>Duplicates skipped</span>
              <span className="tabular-nums">{result.duplicates}</span>
            </div>
          )}
          {/* Iter 127 — DNC scrub count, separately toned because
              it's a compliance metric the operator may care about
              tracking over time vs. plain duplicates. */}
          {result.dnc_scrubbed > 0 && (
            <div className="flex justify-between text-error">
              <span>DNC matches skipped</span>
              <span className="tabular-nums">{result.dnc_scrubbed}</span>
            </div>
          )}
          {result.rejected > 0 && (
            <div className="flex justify-between text-error">
              <span>Rejected</span>
              <span className="tabular-nums">{result.rejected}</span>
            </div>
          )}
          {/* Iter 127 — sampled duplicate phones (first 50). Lets
              an operator spot WHICH numbers were the dupes without
              opening the list page and grepping. */}
          {result.duplicate_phones.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-fg-subtle">
                Show sample duplicate phones
              </summary>
              <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-fg-muted">
                {result.duplicate_phones.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
                {result.duplicates > result.duplicate_phones.length && (
                  <li className="text-fg-subtle">
                    … and{' '}
                    {result.duplicates - result.duplicate_phones.length}{' '}
                    more
                  </li>
                )}
              </ul>
            </details>
          )}
          {result.dnc_phones.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-fg-subtle">
                Show sample DNC matches
              </summary>
              <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-fg-muted">
                {result.dnc_phones.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
                {result.dnc_scrubbed > result.dnc_phones.length && (
                  <li className="text-fg-subtle">
                    … and{' '}
                    {result.dnc_scrubbed - result.dnc_phones.length} more
                  </li>
                )}
              </ul>
            </details>
          )}
          {result.rejections.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-fg-subtle">
                Show rejection reasons
              </summary>
              <ul className="mt-1 max-h-32 overflow-y-auto font-mono text-fg-muted">
                {result.rejections.slice(0, 50).map((r, i) => (
                  <li key={i}>
                    row {r.row}: {r.reason}
                  </li>
                ))}
                {result.rejections.length > 50 && (
                  <li className="text-fg-subtle">
                    … and {result.rejections.length - 50} more
                  </li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={!file || submitting}
        className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-accent-fg px-4 py-2 rounded text-sm w-full"
      >
        {submitting ? 'Uploading…' : 'Upload CSV'}
      </button>
    </form>
  );
}
