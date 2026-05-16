'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AudioFile {
  id: string;
  name: string;
  description: string | null;
  category: string;
  path: string;
  source: string;
  duration_ms: number | null;
  size_bytes: number;
  created_at: string;
  created_by_user_id: string | null;
}
interface Usage {
  audio_path: string;
  ref_type: string;
  ref_id: string;
  ref_name: string;
  field: string;
}
interface Props {
  initialFiles: AudioFile[];
  usage: Usage[];
  stats: { count: number; totalBytes: number; root: string; node: string };
}

const CATEGORIES = [
  'all',
  'menu_prompt',
  'voicemail',
  'recording_notice',
  'hold_music',
  'disclaimer',
  'other',
] as const;

function fmtBytes(n: number): string {
  if (!n || n < 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function fmtDur(ms: number | null): string {
  if (ms == null || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function AudioCenterClient({ initialFiles, usage, stats }: Props) {
  const router = useRouter();
  const [files, setFiles] = useState<AudioFile[]>(initialFiles);
  const [cat, setCat] = useState<string>('all');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [upName, setUpName] = useState('');
  const [upCat, setUpCat] = useState('menu_prompt');
  const [upFile, setUpFile] = useState<File | null>(null);

  // path → usage[]
  const usageByPath = useMemo(() => {
    const m = new Map<string, Usage[]>();
    for (const u of usage) {
      const arr = m.get(u.audio_path) ?? [];
      arr.push(u);
      m.set(u.audio_path, arr);
    }
    return m;
  }, [usage]);

  const shown = useMemo(
    () => (cat === 'all' ? files : files.filter((f) => f.category === cat)),
    [files, cat],
  );

  async function refresh() {
    const r = await fetch('/api/audio-files', { credentials: 'same-origin' });
    if (r.ok) {
      const j = (await r.json()) as { files: AudioFile[] };
      setFiles(j.files);
    }
  }

  async function upload() {
    if (!upFile || !upName.trim()) {
      setErr('Name + file required');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set('name', upName.trim());
      fd.set('category', upCat);
      fd.set('source', 'uploaded');
      fd.set('file', upFile);
      const r = await fetch('/api/audio-files', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setUpName('');
      setUpFile(null);
      await refresh();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function del(f: AudioFile) {
    const used = usageByPath.get(f.path) ?? [];
    if (used.length > 0) {
      if (
        !confirm(
          `"${f.name}" is used by ${used.length} item(s): ${used
            .map((u) => `${u.ref_name}/${u.field}`)
            .join(', ')}. Deleting will break those. Continue?`,
        )
      )
        return;
    } else if (!confirm(`Delete "${f.name}"?`)) {
      return;
    }
    const r = await fetch(`/api/audio-files/${f.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      setErr(j.error ?? `HTTP ${r.status}`);
      return;
    }
    setFiles((p) => p.filter((x) => x.id !== f.id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-xs text-fg-subtle border border-border rounded p-3 bg-card">
        <span>
          <strong className="text-fg">{stats.count}</strong> files
        </span>
        <span>
          <strong className="text-fg">{fmtBytes(stats.totalBytes)}</strong> on disk
        </span>
        <span>
          root <span className="font-mono">{stats.root}</span>
        </span>
        <span>
          node <span className="font-mono">{stats.node}</span>
        </span>
      </div>

      <div className="border border-border rounded p-4 bg-card">
        <h2 className="text-sm font-semibold mb-2">Upload audio</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-fg-subtle mb-1">Name</label>
            <input
              value={upName}
              onChange={(e) => setUpName(e.target.value)}
              className="border border-border rounded bg-bg px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">Category</label>
            <select
              value={upCat}
              onChange={(e) => setUpCat(e.target.value)}
              className="border border-border rounded bg-bg px-2 py-1 text-sm"
            >
              {CATEGORIES.filter((c) => c !== 'all').map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">
              File (.wav / .mp3)
            </label>
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => setUpFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
          </div>
          <button
            type="button"
            onClick={() => void upload()}
            disabled={busy}
            className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {err && <p className="text-error text-xs mt-2">{err}</p>}
        <p className="text-xs text-fg-subtle mt-2">
          Record-in-browser + TTS generation live on the{' '}
          <a href="/sound-board" className="text-link hover:underline">
            Sound Board
          </a>{' '}
          (same library).
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <label className="text-fg-subtle text-xs">Filter</label>
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="border border-border rounded bg-bg px-2 py-1 text-xs"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="text-fg-subtle text-xs">
          {shown.length} shown
        </span>
      </div>

      <table className="w-full text-sm border border-border rounded">
        <thead className="bg-card">
          <tr className="text-left">
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Category</th>
            <th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">Size</th>
            <th className="px-3 py-2">Dur</th>
            <th className="px-3 py-2">Created</th>
            <th className="px-3 py-2">Used by</th>
            <th className="px-3 py-2">Preview</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-3 py-6 text-center text-fg-muted">
                No audio files{cat !== 'all' ? ` in ${cat}` : ''}.
              </td>
            </tr>
          ) : (
            shown.map((f) => {
              const used = usageByPath.get(f.path) ?? [];
              return (
                <tr key={f.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    {f.name}
                    {f.description && (
                      <span className="block text-xs text-fg-subtle">
                        {f.description}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {f.category}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{f.source}</td>
                  <td className="px-3 py-2 tabular-nums text-xs">
                    {fmtBytes(f.size_bytes)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-xs">
                    {fmtDur(f.duration_ms)}
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-subtle">
                    {new Date(f.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {used.length === 0 ? (
                      <span className="text-fg-muted">unused</span>
                    ) : (
                      <span className="space-x-1">
                        {used.slice(0, 4).map((u, idx) => (
                          <span
                            key={idx}
                            className="inline-block px-1.5 py-0.5 rounded border border-border text-[10px]"
                            title={`${u.ref_type}: ${u.field}`}
                          >
                            {u.ref_name}
                          </span>
                        ))}
                        {used.length > 4 && (
                          <span className="text-fg-subtle">
                            +{used.length - 4}
                          </span>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <audio
                      src={`/api/audio-files/${f.id}`}
                      controls
                      preload="none"
                      className="h-7 w-44"
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void del(f)}
                      className={
                        used.length > 0
                          ? 'text-warn hover:underline text-xs'
                          : 'text-error hover:underline text-xs'
                      }
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
