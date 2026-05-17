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
  audio?: string | null;
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
  const [phase, setPhase] = useState<'' | 'greet' | 'listen' | 'think' | 'speak'>(
    '',
  );
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const activeRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const vadRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const histRef = useRef<Line[]>([]);

  const persona = personas.find((p) => p.id === personaId);
  const scopeBad = scopeType !== 'global' && !scopeId;

  function pushLine(l: Line) {
    histRef.current = [...histRef.current, l];
    setLines([...histRef.current]);
  }
  function historyPayload() {
    return histRef.current
      .slice(1) // drop the opening greeting (live seeds it itself)
      .map((l) => ({
        role: l.who === 'you' ? 'caller' : 'ai',
        text: l.text,
      }));
  }
  function playB64(b64: string, onDone?: () => void) {
    try {
      const a = new Audio(`data:audio/wav;base64,${b64}`);
      audioElRef.current = a;
      a.onended = () => onDone?.();
      a.onerror = () => onDone?.();
      void a.play().catch(() => onDone?.());
    } catch {
      onDone?.();
    }
  }

  // ---------- TEXT MODE ----------
  async function start() {
    if (!persona) {
      setMsg('Pick a persona');
      return;
    }
    setMsg(null);
    histRef.current = [{ who: 'ai', text: persona.greeting }];
    setLines([...histRef.current]);
    setStarted(true);
    activeRef.current = true;
    if (io === 'audio') void beginAudioCall();
  }

  async function sendText() {
    const line = draft.trim();
    if (!line || !persona) return;
    setBusy(true);
    setMsg(null);
    pushLine({ who: 'you', text: line });
    setDraft('');
    try {
      const r = await fetch('/api/ai/mock-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          persona_id: personaId,
          history: historyPayload(),
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
      pushLine({
        who: 'ai',
        text: j.reply ?? '',
        ms: j.ms,
        kb: j.used_knowledge,
      });
    } finally {
      setBusy(false);
    }
  }

  // ---------- AUDIO LIVE CALL ----------
  async function beginAudioCall() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      streamRef.current = stream;
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      acRef.current = new AC();
    } catch {
      setMsg('Microphone permission denied — audio call needs mic access');
      hangup();
      return;
    }
    // Speak the greeting, then start listening.
    setPhase('greet');
    try {
      const fd = new FormData();
      fd.append('persona_id', personaId);
      fd.append('greet', '1');
      const r = await fetch('/api/ai/mock-call/audio', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      const j = (await r.json().catch(() => ({}))) as {
        audio_wav_base64?: string | null;
      };
      if (!activeRef.current) return;
      if (j.audio_wav_base64) {
        playB64(j.audio_wav_base64, () => listen());
      } else {
        listen();
      }
    } catch {
      if (activeRef.current) listen();
    }
  }

  function listen() {
    if (!activeRef.current || !streamRef.current || !acRef.current) return;
    setPhase('listen');
    chunksRef.current = [];
    const stream = streamRef.current;
    let mime = '';
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
    }
    const rec = mime
      ? new MediaRecorder(stream, { mimeType: mime })
      : new MediaRecorder(stream);
    recRef.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      if (vadRef.current) {
        clearInterval(vadRef.current);
        vadRef.current = null;
      }
      const blob = new Blob(chunksRef.current, {
        type: rec.mimeType || 'audio/webm',
      });
      if (activeRef.current) void sendTurn(blob);
    };
    rec.start();

    // Energy VAD: end the turn ~1.3s after the caller stops.
    const ac = acRef.current;
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    const t0 = Date.now();
    let spoke = false;
    let lastVoice = Date.now();
    vadRef.current = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i]! - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      const now = Date.now();
      if (rms > 0.025) {
        if (now - t0 > 250) spoke = true;
        lastVoice = now;
      }
      const silenceFor = now - lastVoice;
      const tooLong = now - t0 > 15000;
      if (
        recRef.current &&
        recRef.current.state === 'recording' &&
        ((spoke && silenceFor > 1300) || tooLong)
      ) {
        try {
          src.disconnect();
        } catch {
          /* noop */
        }
        recRef.current.stop();
      }
    }, 100);
  }

  function stopTurnManual() {
    if (recRef.current && recRef.current.state === 'recording') {
      recRef.current.stop();
    }
  }

  async function sendTurn(blob: Blob) {
    if (!activeRef.current || !persona) return;
    if (blob.size < 1200) {
      // basically silence — keep listening
      if (activeRef.current) listen();
      return;
    }
    setPhase('think');
    try {
      const fd = new FormData();
      fd.append('audio', blob, 'turn.webm');
      fd.append('persona_id', personaId);
      fd.append('history', JSON.stringify(historyPayload()));
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
        silence?: boolean;
        error?: string;
      };
      if (!activeRef.current) return;
      if (!r.ok || !j.ok) {
        setMsg(j.error ?? `HTTP ${r.status}`);
        listen();
        return;
      }
      if (j.silence || !j.transcript) {
        listen(); // no speech detected — just keep listening
        return;
      }
      pushLine({ who: 'you', text: j.transcript });
      pushLine({
        who: 'ai',
        text: j.reply ?? '',
        ms: j.ms,
        kb: j.used_knowledge,
        audio: j.audio_wav_base64 ?? null,
      });
      if (j.audio_wav_base64) {
        setPhase('speak');
        playB64(j.audio_wav_base64, () => {
          if (activeRef.current) listen();
        });
      } else {
        listen();
      }
    } catch {
      if (activeRef.current) listen();
    }
  }

  function hangup() {
    activeRef.current = false;
    setStarted(false);
    setPhase('');
    if (vadRef.current) {
      clearInterval(vadRef.current);
      vadRef.current = null;
    }
    try {
      if (recRef.current && recRef.current.state !== 'inactive')
        recRef.current.stop();
    } catch {
      /* noop */
    }
    if (audioElRef.current) {
      try {
        audioElRef.current.pause();
      } catch {
        /* noop */
      }
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (acRef.current) {
      void acRef.current.close().catch(() => {});
      acRef.current = null;
    }
    setLines([]);
    histRef.current = [];
    setDraft('');
  }

  const sel = 'border border-border rounded bg-bg px-2 py-1 text-sm';
  const phaseLabel =
    phase === 'greet'
      ? 'Agent is greeting…'
      : phase === 'listen'
        ? '🎤 Listening — just talk, pause when done'
        : phase === 'think'
          ? '…transcribing + thinking'
          : phase === 'speak'
            ? '🔊 Agent speaking…'
            : '';

  return (
    <div className="border border-border rounded p-4 bg-card mt-6 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Mock call (test)</h2>
        <p className="text-xs text-fg-subtle mt-0.5">
          Audio mode is a real, hands-free call: the agent greets
          you, then just talk — it auto-detects when you stop,
          replies in voice, and listens again. Same pipeline as a
          live phone call (guards + trained memory + local model +
          identity scrub). Nothing is saved. On this CPU box each
          reply takes a few seconds.
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
            {personas.length === 0 && <option value="">(none)</option>}
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
            <option value="audio">Audio (live, hands-free)</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">Memory scope</span>
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
            onClick={() => void start()}
            disabled={!personaId || scopeBad}
            className="self-end bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {io === 'audio' ? 'Start call' : 'Start mock call'}
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
          {io === 'audio' && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-fg-subtle">
                {phaseLabel}
              </span>
              {phase === 'listen' && (
                <button
                  type="button"
                  onClick={stopTurnManual}
                  className="text-[11px] border border-border rounded px-2 py-0.5"
                >
                  done talking
                </button>
              )}
            </div>
          )}
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
          </div>

          {io === 'text' && (
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
          )}
        </div>
      )}
      {msg && <p className="text-xs text-error">{msg}</p>}
    </div>
  );
}
