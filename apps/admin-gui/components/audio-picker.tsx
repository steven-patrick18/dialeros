'use client';

import { useEffect, useState } from 'react';

// Iter 150 — AudioPicker: dropdown listing Sound Board entries
// (filtered by category) with an inline preview button. Used by
// the call-menu form for prompt selection; iter 151+ will swap
// the campaigns voicemail_path + in_groups greeting fields onto
// this too.
//
// `value` is the file path (matches the path column FS plays).
// `onChange(path)` receives the same. We carry just the path —
// not the audio file id — because the legacy schema columns
// (call_menus.prompt_path, campaigns.voicemail_path, etc.) are
// path-typed and the dialplan generator in iter 152 reads them
// straight. Migrating to FK would require a bigger ripple.

interface AudioRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  path: string;
  source: string;
  duration_ms: number | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  menu_prompt: 'Menu prompt',
  hold: 'Hold music',
  voicemail: 'Voicemail message',
  disclaimer: 'Disclaimer',
  other: 'Other',
};

export function AudioPicker({
  value,
  onChange,
  category,
  placeholder = '— pick a sound —',
}: {
  value: string;
  onChange: (path: string) => void;
  category?: string;
  placeholder?: string;
}) {
  const [files, setFiles] = useState<AudioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = category
      ? `/api/audio-files?category=${encodeURIComponent(category)}`
      : '/api/audio-files';
    fetch(url, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((data: { files: AudioRow[] }) => {
        if (!cancelled) setFiles(data.files);
      })
      .catch(() => {
        /* leave files empty; UI shows "no files" */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  const selected = files.find((f) => f.path === value);

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input flex-1"
          disabled={loading}
        >
          <option value="">{placeholder}</option>
          {files.map((f) => (
            <option key={f.id} value={f.path}>
              {f.name}
              {category ? '' : ` (${CATEGORY_LABELS[f.category] ?? f.category})`}
              {f.duration_ms ? ` — ${Math.round(f.duration_ms / 1000)}s` : ''}
            </option>
          ))}
        </select>
        {selected ? (
          <button
            type="button"
            onClick={() =>
              setPreviewing(previewing === selected.id ? null : selected.id)
            }
            className="text-xs text-link hover:underline px-2 whitespace-nowrap"
          >
            {previewing === selected.id ? 'Hide' : '▶ Preview'}
          </button>
        ) : null}
      </div>
      {selected && previewing === selected.id ? (
        <audio
          controls
          autoPlay
          src={`/api/audio-files/${selected.id}`}
          className="w-full h-8"
        />
      ) : null}
      {selected ? (
        <p className="text-[10px] font-mono text-fg-subtle">
          {selected.path}
        </p>
      ) : null}
      {!loading && files.length === 0 ? (
        <p className="text-xs text-fg-subtle">
          No sounds in this category yet —{' '}
          <a href="/sound-board" className="text-link hover:underline">
            upload one
          </a>
          .
        </p>
      ) : null}
    </div>
  );
}
