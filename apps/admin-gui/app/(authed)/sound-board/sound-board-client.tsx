'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Iter 150 — Sound Board client. Three sub-sections:
//   1. Library table — every audio_files row with inline preview,
//      delete button, and the FS path (so an operator can paste
//      it into a campaign field if needed).
//   2. Upload card — pick a .wav/.mp3, set name + category +
//      description, POST multipart to /api/audio-files.
//   3. Record card — in-browser MediaRecorder. "Record" starts the
//      stream, "Stop" ends it; the recording auto-previews; "Save"
//      POSTs the blob to the same endpoint with source=recorded.

interface AudioRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  path: string;
  source: string;
  duration_ms: number | null;
  size_bytes: number;
  created_at: string;
}

const CATEGORIES = [
  { value: 'menu_prompt', label: 'Menu prompt' },
  { value: 'hold', label: 'Hold music' },
  { value: 'voicemail', label: 'Voicemail message' },
  { value: 'disclaimer', label: 'Disclaimer' },
  { value: 'other', label: 'Other' },
];

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${(s % 60).toString().padStart(2, '0')}s`;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export function SoundBoardClient({
  initial,
}: {
  initial: AudioRow[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<AudioRow[]>(initial);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/audio-files', {
        credentials: 'same-origin',
      });
      if (res.ok) {
        const data = (await res.json()) as { files: AudioRow[] };
        setRows(data.files);
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This removes the file from disk too.`)) {
      return;
    }
    const res = await fetch(`/api/audio-files/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok) {
      await refresh();
      router.refresh();
    } else {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      alert(data.error ?? `Delete failed (HTTP ${res.status})`);
    }
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <UploadCard onSaved={refresh} />
        <RecordCard onSaved={refresh} />
        <TtsCard onSaved={refresh} />
      </div>

      <section>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted">
            Library ({rows.length})
          </h2>
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="text-xs text-link hover:underline disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {rows.length === 0 ? (
          <p className="text-fg-subtle text-sm">
            Library empty. Upload a file or record one above.
          </p>
        ) : (
          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-bg-elevated text-fg-subtle text-left">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Duration</th>
                  <th className="px-3 py-2">Size</th>
                  <th className="px-3 py-2">Preview</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.name}</div>
                      {r.description ? (
                        <div className="text-xs text-fg-subtle">
                          {r.description}
                        </div>
                      ) : null}
                      <div className="text-[10px] font-mono text-fg-subtle mt-1">
                        {r.path}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {CATEGORIES.find((c) => c.value === r.category)?.label ??
                        r.category}
                    </td>
                    <td className="px-3 py-2 text-xs text-fg-subtle">
                      {r.source}
                    </td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                      {fmtDuration(r.duration_ms)}
                    </td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                      {fmtBytes(r.size_bytes)}
                    </td>
                    <td className="px-3 py-2">
                      <audio
                        controls
                        preload="none"
                        src={`/api/audio-files/${r.id}`}
                        className="h-8 w-48"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(r.id, r.name)}
                        className="text-error hover:text-error-strong text-xs"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function UploadCard({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('menu_prompt');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Pick a file first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const fd = new FormData();
    fd.set('name', name);
    fd.set('description', description);
    fd.set('category', category);
    fd.set('source', 'uploaded');
    fd.set('file', file);
    try {
      const res = await fetch('/api/audio-files', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setName('');
      setDescription('');
      setFile(null);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-border rounded p-4 space-y-3"
    >
      <h2 className="text-xs uppercase tracking-wide text-fg-muted">
        Upload
      </h2>
      <label className="text-sm flex flex-col gap-1">
        <span className="text-fg-subtle">Name</span>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          placeholder="welcome-greeting"
        />
      </label>
      <label className="text-sm flex flex-col gap-1">
        <span className="text-fg-subtle">Description</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input"
          placeholder="Main inbound greeting — press 1 for sales..."
        />
      </label>
      <label className="text-sm flex flex-col gap-1">
        <span className="text-fg-subtle">Category</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="input"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm flex flex-col gap-1">
        <span className="text-fg-subtle">File (.wav / .mp3, max 50MB)</span>
        <input
          type="file"
          accept=".wav,.mp3,audio/wav,audio/mpeg"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="input"
        />
      </label>
      {error ? <div className="text-error text-xs">{error}</div> : null}
      <button
        type="submit"
        disabled={submitting || !file}
        className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-50 w-full"
      >
        {submitting ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  );
}

function RecordCard({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('menu_prompt');
  const [recording, setRecording] = useState(false);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedHandle = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      // Clean up blob URL when component unmounts.
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (elapsedHandle.current) window.clearInterval(elapsedHandle.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [previewUrl]);

  async function start() {
    setError(null);
    setBlob(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const finalBlob = new Blob(chunksRef.current, {
          type: rec.mimeType || 'audio/webm',
        });
        setBlob(finalBlob);
        setPreviewUrl(URL.createObjectURL(finalBlob));
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setElapsed(0);
      elapsedHandle.current = window.setInterval(
        () => setElapsed((s) => s + 1),
        1000,
      );
    } catch (e) {
      setError(
        `Mic access denied or unavailable: ${(e as Error).message}. ` +
          `Sound Board recording needs HTTPS or localhost; check the address bar.`,
      );
    }
  }

  function stop() {
    if (recorderRef.current && recording) {
      recorderRef.current.stop();
      setRecording(false);
      if (elapsedHandle.current) {
        window.clearInterval(elapsedHandle.current);
        elapsedHandle.current = null;
      }
    }
  }

  async function save() {
    if (!blob) return;
    setSubmitting(true);
    setError(null);
    const fd = new FormData();
    fd.set('name', name);
    fd.set('description', description);
    fd.set('category', category);
    fd.set('source', 'recorded');
    fd.set('file', blob, 'recording.webm');
    try {
      const res = await fetch('/api/audio-files', {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      // Reset.
      setName('');
      setDescription('');
      setBlob(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-border rounded p-4 space-y-3">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted">
        Record in browser
      </h2>
      <label className="text-sm flex flex-col gap-1">
        <span className="text-fg-subtle">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          placeholder="my-recording"
          disabled={recording}
        />
      </label>
      <label className="text-sm flex flex-col gap-1">
        <span className="text-fg-subtle">Description</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input"
          disabled={recording}
        />
      </label>
      <label className="text-sm flex flex-col gap-1">
        <span className="text-fg-subtle">Category</span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="input"
          disabled={recording}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center gap-3">
        {!recording ? (
          <button
            type="button"
            onClick={start}
            disabled={submitting}
            className="bg-error hover:bg-error-strong text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            ● Record
          </button>
        ) : (
          <button
            type="button"
            onClick={stop}
            className="bg-fg hover:bg-fg/90 text-bg px-3 py-1.5 rounded text-sm"
          >
            ■ Stop ({elapsed}s)
          </button>
        )}
        {blob ? (
          <span className="text-xs text-fg-subtle">
            {(blob.size / 1024).toFixed(1)} KB recorded
          </span>
        ) : null}
      </div>

      {previewUrl ? (
        <audio controls src={previewUrl} className="w-full h-8" />
      ) : null}

      {error ? <div className="text-error text-xs">{error}</div> : null}

      <button
        type="button"
        onClick={save}
        disabled={submitting || !blob || !name}
        className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-50 w-full"
      >
        {submitting ? 'Saving…' : 'Save to library'}
      </button>
    </div>
  );
}

function TtsCard({ onSaved }: { onSaved: () => void }) {
  const [engine, setEngine] = useState<'piper' | 'coqui'>('piper');
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [installCommand, setInstallCommand] = useState<string>('');
  const [voices, setVoices] = useState<{ name: string; model_path: string }[]>(
    [],
  );
  const [voice, setVoice] = useState<string>('');
  const [coquiInstalled, setCoquiInstalled] = useState<boolean>(false);
  const [coquiSupportsClone, setCoquiSupportsClone] = useState<boolean>(false);
  const [cloneSources, setCloneSources] = useState<
    { id: string; name: string; description: string | null }[]
  >([]);
  const [voiceCloneAudioId, setVoiceCloneAudioId] = useState<string>('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('menu_prompt');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/audio-files/tts', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then(
        (data: {
          installed: boolean;
          install_command?: string;
          voices: { name: string; model_path: string }[];
          engines?: {
            piper: {
              installed: boolean;
              install_command?: string;
              voices: { name: string; model_path: string }[];
            };
            coqui: {
              installed: boolean;
              loaded?: boolean;
              model?: string;
              supports_clone?: boolean;
            };
          };
        }) => {
          if (cancelled) return;
          setInstalled(data.installed);
          setInstallCommand(data.install_command ?? '');
          setVoices(data.voices);
          if (data.voices.length > 0) {
            const sorted = [...data.voices].sort(
              (a, b) =>
                voiceQualityRank(b.name) - voiceQualityRank(a.name),
            );
            setVoice(sorted[0]!.name);
          }
          if (data.engines?.coqui) {
            setCoquiInstalled(data.engines.coqui.installed);
            setCoquiSupportsClone(
              Boolean(data.engines.coqui.supports_clone),
            );
          }
        },
      )
      .catch(() => {
        if (!cancelled) setInstalled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // When Coqui engine is selected, load the list of recorded /
  // uploaded clips an operator could use as a voice-clone source.
  // XTTS-v2 needs a 6-15 second sample; we don't enforce length
  // here (recording duration isn't reliably reported pre-ffprobe)
  // but the UI hint nudges operators.
  useEffect(() => {
    if (engine !== 'coqui' || !coquiSupportsClone) return;
    let cancelled = false;
    fetch('/api/audio-files', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then(
        (data: {
          files: {
            id: string;
            name: string;
            description: string | null;
            source: string;
          }[];
        }) => {
          if (cancelled) return;
          // Any non-TTS source is a candidate for cloning — both
          // 'uploaded' and 'recorded'. Hide TTS-generated rows so
          // operators don't accidentally feed XTTS its own output.
          setCloneSources(
            data.files
              .filter((f) => f.source !== 'tts')
              .map((f) => ({
                id: f.id,
                name: f.name,
                description: f.description,
              })),
          );
        },
      )
      .catch(() => setCloneSources([]));
    return () => {
      cancelled = true;
    };
  }, [engine, coquiSupportsClone]);

  async function generate() {
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        engine,
        text,
        name,
        description,
        category,
      };
      if (engine === 'piper') payload.voice = voice;
      if (engine === 'coqui' && voiceCloneAudioId) {
        payload.voice_clone_audio_id = voiceCloneAudioId;
      }
      const res = await fetch('/api/audio-files/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setText('');
      setName('');
      setDescription('');
      setVoiceCloneAudioId('');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="border border-border rounded p-4 space-y-3">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted">
        Text-to-speech
      </h2>
      <label className="text-sm flex flex-col gap-1">
        <span className="text-fg-subtle">Engine</span>
        <select
          value={engine}
          onChange={(e) => setEngine(e.target.value as 'piper' | 'coqui')}
          className="input"
        >
          <option value="piper">
            piper — fast (RTF 0.15), 5 voices, no cloning
          </option>
          <option value="coqui" disabled={!coquiInstalled}>
            {coquiInstalled
              ? `coqui XTTS-v2 — voice cloning, RTF ~1.0${
                  coquiSupportsClone ? '' : ' (no clone support detected)'
                }`
              : 'coqui — not installed (run install-coqui-tts.sh)'}
          </option>
        </select>
      </label>
      {installed === null ? (
        <p className="text-fg-subtle text-sm">Checking piper-tts…</p>
      ) : !installed && engine === 'piper' ? (
        <div className="text-sm space-y-2">
          <p className="text-warn">
            piper-tts not installed yet. Run on the server:
          </p>
          <pre className="bg-bg-elevated p-2 rounded border border-border text-xs font-mono break-all">
            {installCommand || 'sudo /opt/dialeros/scripts/install-piper-tts.sh'}
          </pre>
        </div>
      ) : engine === 'coqui' && !coquiInstalled ? (
        <div className="text-sm space-y-2">
          <p className="text-warn">Coqui daemon not reachable. Run:</p>
          <pre className="bg-bg-elevated p-2 rounded border border-border text-xs font-mono break-all">
            sudo /opt/dialeros/scripts/install-coqui-tts.sh
            {'\n'}sudo systemctl enable --now dialeros-coqui-tts
          </pre>
        </div>
      ) : (
        <>
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              placeholder="welcome-tts"
            />
          </label>
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Description (optional)</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input"
            />
          </label>
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Category</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="input"
            >
              <option value="menu_prompt">Menu prompt</option>
              <option value="hold">Hold music</option>
              <option value="voicemail">Voicemail message</option>
              <option value="disclaimer">Disclaimer</option>
              <option value="other">Other</option>
            </select>
          </label>
          {engine === 'piper' ? (
            <label className="text-sm flex flex-col gap-1">
              <span className="text-fg-subtle">
                Voice{' '}
                <span className="text-[10px] text-fg-subtle">
                  (high &gt; medium &gt; low — sorted best-first)
                </span>
              </span>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="input"
                disabled={voices.length === 0}
              >
                {voices.length === 0 ? (
                  <option value="">No voices found in piper-voices/</option>
                ) : (
                  [...voices]
                    .sort(
                      (a, b) =>
                        voiceQualityRank(b.name) - voiceQualityRank(a.name) ||
                        a.name.localeCompare(b.name),
                    )
                    .map((v) => (
                      <option key={v.name} value={v.name}>
                        {voiceLabel(v.name)}
                      </option>
                    ))
                )}
              </select>
            </label>
          ) : (
            <label className="text-sm flex flex-col gap-1">
              <span className="text-fg-subtle">
                Voice clone source{' '}
                <span className="text-[10px] text-fg-subtle">
                  (optional — leave blank for the model's default speaker)
                </span>
              </span>
              <select
                value={voiceCloneAudioId}
                onChange={(e) => setVoiceCloneAudioId(e.target.value)}
                className="input"
              >
                <option value="">
                  — default speaker (no cloning) —
                </option>
                {cloneSources.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.description ? ` · ${c.description.slice(0, 40)}` : ''}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-fg-subtle">
                For best results, the source clip should be 6-15
                seconds of a single speaker talking clearly. Record
                via the "Record in browser" card to the left, then
                refresh this list.
              </span>
            </label>
          )}
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Text to speak (max 2000 chars)</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="input"
              rows={4}
              placeholder="Welcome to Acme. Press 1 for sales, 2 for support."
              maxLength={2000}
            />
          </label>
          {error ? <div className="text-error text-xs">{error}</div> : null}
          <button
            type="button"
            onClick={generate}
            disabled={
              submitting ||
              !text.trim() ||
              !name ||
              (engine === 'piper' && !voice)
            }
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-50 w-full"
          >
            {submitting
              ? engine === 'coqui'
                ? 'Generating (XTTS can take 10-30s)…'
                : 'Generating…'
              : 'Generate & save'}
          </button>
        </>
      )}
    </div>
  );
}

// Iter 161 — piper voice helpers. Voice names look like
// "<lang>-<speaker>-<quality>", e.g. "en_US-libritts-high".
// Quality tier dominates naturalness; high > medium > low > x_low.
function voiceQualityRank(name: string): number {
  if (name.endsWith('-high')) return 3;
  if (name.endsWith('-medium')) return 2;
  if (name.endsWith('-low')) return 1;
  if (name.endsWith('-x_low')) return 0;
  return 0;
}

function voiceLabel(name: string): string {
  const tier = name.endsWith('-high')
    ? '✦ HIGH'
    : name.endsWith('-medium')
      ? 'medium'
      : 'low';
  // Pretty-print speaker name: en_US-libritts-high -> en-US · libritts (HIGH)
  const m = /^([a-z]{2})_([A-Z]{2})-(.+)-(high|medium|low|x_low)$/.exec(name);
  if (m) {
    return `${m[1]}-${m[2]} · ${m[3]} (${tier})`;
  }
  return `${name} (${tier})`;
}
