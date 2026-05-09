'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface IngestResult {
  parsed: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  rejections: Array<{ row: number; reason: string }>;
}

export function UploadCsvForm({ listId }: { listId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setSubmitting(true);
    setError(null);
    setResult(null);

    const fd = new FormData();
    fd.append('file', file);

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
          {result.rejected > 0 && (
            <div className="flex justify-between text-error">
              <span>Rejected</span>
              <span className="tabular-nums">{result.rejected}</span>
            </div>
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
