'use client';

import { useRef, useState } from 'react';

interface PersonaOpt {
  id: string;
  name: string;
  greeting: string;
  agent_name: string | null;
  agent_title: string | null;
}
interface ScopeOpt {
  id: string;
  name: string;
}
interface Line {
  who: 'you' | 'ai';
  text: string;
  ms?: number;
  kb?: boolean;
  audio?: string | null; // base64 wav (audio mode)
}

export function MockCallPanel({
  personas,
  campaigns,
  inGroups,
}: {
  personas: PersonaOpt[];
  campaigns: ScopeOpt[];
  inGroups: ScopeOpt[];
}) {
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? '');
  const [io, setIo] = useState<'text' | 'audio'>('text');
  const [scopeType, setScopeType] = useState('global');
  const [scopeId, setScopeId] = useState('');
  const [started, setStarted] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const persona = personas.find((p) => p.id === personaId);
  const scopeBad = scopeType !== 'global' && !scopeId;

  function start() {
    if (!persona) {
      setMsg('Pick a persona');
      return;
    }
    setMsg(null);
    setLines([{ who: 'ai', text: persona.greeting }]);
    setStarted(true);
  }
  function hangup() {
    if (recRef.current && recording) recRef.current.stop();
    setStarted(false);
    setRecording(false);
    setLines([]);
    setDraft('');
    setMsg(null);
  }

  function historyPayload(extra: Line[]) {
    return [...lines, ...extra]
      .slice(1) // drop the opening greeting (live seeds it itself)
      .map((l) => ({
        role: l.who === 'you' ? 'caller' : 'ai',
        text: l.text,
      }));
  }

  function playB64(b64: string) {
    try {
      const a = new Audio(`data:audio/wav;base64,${b64}`);
      void a.play();
    } catch {
      /* autoplay may be blocked; the bubble still has audio */
    }
  }

  async function sendText() {
    const line = draft.trim();
    if (!line || !persona) return;
    setBusy(true);
    setMsg(null);
    const youLine: Line = { who: 'you', text: line };
    setLines((c) => [...c, youLine]);
    setDraft('');
    try {
      const r = await fetch('/api/ai/mock-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          persona_id: personaId,
          history: historyPayload([youLine]),
          customer_line: line,
          scope_type: scopeType,
          scope_id: scopeType === 'global' ? '' : scopeId,
        }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        reply?: string;
        used_knowledge?: boolean;
        ms?: number;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        setMsg(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setLines((c) => [
        ...c,
        { who: 'ai', text: j.reply ?? '', ms: j.ms, kb: j.used_knowledge },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      chunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void sendAudio(
          new Blob(chunksRef.current, {
            type: mr.mimeType || 'audio/webm',
          }),
        );
      };
      recRef.current = mr;
      mr.start();
      setRecording(true);
      setMsg(null);
    } catch {
      setMsg('Microphone permission denied / unavailable');
    }
  }
  function stopRec() {
    if (recRef.current && recording) {
      recRef.current.stop();
      setRecording(false);
    }
  }

  async function sendAudio(blob: Blob) {
    if (!persona || blob.size === 0) return;
    setBusy(true);
    setMsg('Transcribing + thinking (CPU box — a few seconds)…');
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'turn.webm');
      fd.append('persona_id', personaId);
      fd.append('history', JSON.stringify(historyPayload([])));
      fd.append('scope_type', scopeType);
      fd.append('scope_id', scopeType === 'global' ? '' : scopeId);
      const r = await fetch('/api/ai/mock-call/audio', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        transcript?: string;
        reply?: string;
        used_knowledge?: boolean;
        ms?: number;
        audio_wav_base64?: string | null;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        setMsg(j.error ?? `HTTP ${r.status}`);
        if (j.transcript)
          setLines((c) => [...c, { who: 'you', text: j.transcript! }]);
        return;
      }
      setMsg(null);
      setLines((c) => [
        ...c,
        { who: 'you', text: j.transcript ?? '(unclear)' },
        {
          who: 'ai',
          text: j.reply ?? '',
          ms: j.ms,
          kb: j.used_knowledge,
          audio: j.audio_wav_base64 ?? null,
        },
      ]);
      if (j.audio_wav_base64) playB64(j.audio_wav_base64);
    } finally {
      setBusy(false);
    }
  }

  const sel = 'border border-border rounded bg-bg px-2 py-1 text-sm';
  return (
    <div className="border border-border rounded p-4 bg-card mt-6 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Mock call (test)</h2>
        <p className="text-xs text-fg-subtle mt-0.5">
          Talk to the agent as a customer — by text or by voice.
          Runs the REAL call pipeline (guards + retrieved trained
          memory + the local model + identity scrub) so it
          predicts a real call. Audio mode = your mic → whisper →
          AI → the same Coqui voice real callers hear. Nothing is
          saved.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">Persona</span>
          <select
            className={sel}
            value={personaId}
            disabled={started}
            onChange={(e) => setPersonaId(e.target.value)}
          >
            {personas.length === 0 && (
              <option value="">(no personas)</option>
            )}
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.agent_name ? ` — ${p.agent_name}` : ''}
                {p.agent_title ? `, ${p.agent_title}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">Mode</span>
          <select
            className={sel}
            value={io}
            disabled={started}
            onChange={(e) => setIo(e.target.value as 'text' | 'audio')}
          >
            <option value="text">Text</option>
            <option value="audio">Audio (mic + voice)</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">
            Memory scope
          </span>
          <select
            className={sel}
            value={scopeType}
            disabled={started}
            onChange={(e) => {
              setScopeType(e.target.value);
              setScopeId('');
            }}
          >
            <option value="global">Global</option>
            <option value="campaign">Campaign</option>
            <option value="in_group">In-group</option>
          </select>
        </label>
        {scopeType !== 'global' && (
          <label className="text-xs">
            <span className="block text-fg-subtle mb-1">
              {scopeType === 'campaign' ? 'Campaign' : 'In-group'}
            </span>
            <select
              className={sel}
              value={scopeId}
              disabled={started}
              onChange={(e) => setScopeId(e.target.value)}
            >
              <option value="">— select —</option>
              {(scopeType === 'campaign' ? campaigns : inGroups).map(
                (o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
        {!started ? (
          <button
            type="button"
            onClick={start}
            disabled={!personaId || scopeBad}
            className="self-end bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            Start mock call
          </button>
        ) : (
          <button
            type="button"
            onClick={hangup}
            className="self-end border border-border text-error px-3 py-1.5 rounded text-sm"
          >
            Hang up
          </button>
        )}
      </div>

      {started && (
        <div className="space-y-2">
          <div className="border border-border rounded bg-bg p-3 space-y-2 max-h-96 overflow-y-auto">
            {lines.map((l, i) => (
              <div
                key={i}
                className={l.who === 'you' ? 'text-right' : 'text-left'}
              >
                <div
                  className={`inline-block rounded px-2 py-1 text-sm ${
                    l.who === 'you'
                      ? 'bg-primary/15'
                      : 'bg-card border border-border'
                  }`}
                >
                  <span className="block text-[10px] text-fg-muted">
                    {l.who === 'you'
                      ? 'You (customer)'
                      : persona?.agent_name || 'Agent'}
                    {l.ms != null ? ` · ${l.ms}ms` : ''}
                    {l.kb ? ' · used trained memory' : ''}
                  </span>
                  {l.text}
                  {l.audio && (
                    <button
                      type="button"
                      onClick={() => playB64(l.audio!)}
                      className="ml-2 text-[10px] text-link underline"
                    >
                      ▶ replay
                    </button>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <p className="text-xs text-fg-subtle">…working</p>
            )}
          </div>

          {io === 'text' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy) void sendText();
              }}
              className="flex gap-2"
            >
              <input
                className="flex-1 border border-border rounded bg-bg px-2 py-1 text-sm"
                placeholder="Type as the customer…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
              >
                {busy ? '…' : 'Send'}
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-3">
              {!recording ? (
                <button
                  type="button"
                  onClick={() => void startRec()}
                  disabled={busy}
                  className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
                >
                  ● Record
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRec}
                  className="bg-error text-on-primary px-3 py-1.5 rounded text-sm animate-pulse"
                >
                  ■ Stop &amp; send
                </button>
              )}
              <span className="text-xs text-fg-subtle">
                {recording
                  ? 'Recording — speak, then Stop & send'
                  : 'Press Record, speak as the customer, then Stop'}
              </span>
            </div>
          )}
        </div>
      )}
      {msg && <p className="text-xs text-fg-subtle">{msg}</p>}
    </div>
  );
}
