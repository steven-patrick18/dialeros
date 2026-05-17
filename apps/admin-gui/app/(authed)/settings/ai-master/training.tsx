'use client';

import { useState } from 'react';

interface ScopeOpt {
  id: string;
  name: string;
}
interface Sess {
  id: string;
  started_at: string;
  status: string;
}

export function TrainingPanel({
  campaigns,
  inGroups,
}: {
  campaigns: ScopeOpt[];
  inGroups: ScopeOpt[];
}) {
  const [mode, setMode] = useState('text');
  const [scopeType, setScopeType] = useState('global');
  const [scopeId, setScopeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // text
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  // audio
  const [file, setFile] = useState<File | null>(null);
  // live call
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [sessionId, setSessionId] = useState('');
  // interview
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const scopeBody = () => ({
    scope_type: scopeType,
    scope_id: scopeType === 'global' ? '' : scopeId,
  });
  const scopeBad = scopeType !== 'global' && !scopeId;

  async function post(body: unknown) {
    const r = await fetch('/api/ai/train', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    return (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      stored?: number;
      error?: string;
      embed_warning?: string | null;
    };
  }

  async function trainText() {
    setBusy(true);
    setMsg(null);
    try {
      const j = await post({ mode: 'text', title, content, ...scopeBody() });
      setMsg(
        j.ok
          ? `Stored ${j.stored} chunk(s).${
              j.embed_warning ? ` ⚠ ${j.embed_warning}` : ''
            }`
          : (j.error ?? 'failed'),
      );
      if (j.ok) {
        setTitle('');
        setContent('');
      }
    } finally {
      setBusy(false);
    }
  }

  async function trainAudio() {
    if (!file) {
      setMsg('Choose an audio file');
      return;
    }
    setBusy(true);
    setMsg('Transcribing locally (this can take a while on CPU)…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('scope_type', scopeType);
      fd.append('scope_id', scopeType === 'global' ? '' : scopeId);
      const r = await fetch('/api/ai/train/audio', {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        stored?: number;
        chars?: number;
        error?: string;
      };
      setMsg(
        j.ok
          ? `Transcribed ${j.chars} chars → ${j.stored} chunk(s) stored.`
          : (j.error ?? `HTTP ${r.status}`),
      );
      if (j.ok) setFile(null);
    } finally {
      setBusy(false);
    }
  }

  async function loadSessions() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/ai/train?mode=sessions', {
        credentials: 'same-origin',
      });
      if (r.ok)
        setSessions(
          ((await r.json()) as { sessions: Sess[] }).sessions ?? [],
        );
    } finally {
      setBusy(false);
    }
  }
  async function trainSession() {
    if (!sessionId) {
      setMsg('Pick a call session');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const j = await post({
        mode: 'session',
        session_id: sessionId,
        ...scopeBody(),
      });
      setMsg(j.ok ? `Stored ${j.stored} chunk(s) from call.` : (j.error ?? 'failed'));
    } finally {
      setBusy(false);
    }
  }

  async function genQuestions() {
    setBusy(true);
    setMsg('Master is composing questions…');
    setQuestions([]);
    setAnswers({});
    try {
      const r = await fetch(
        `/api/ai/train?mode=interview&scope_type=${scopeType}&scope_id=${
          scopeType === 'global' ? '' : encodeURIComponent(scopeId)
        }&n=6`,
        { credentials: 'same-origin' },
      );
      const j = (await r.json().catch(() => ({}))) as {
        questions?: string[];
        error?: string;
      };
      if (!r.ok || !j.questions?.length) {
        setMsg(j.error ?? 'no questions returned');
        return;
      }
      setQuestions(j.questions);
      setMsg(null);
    } finally {
      setBusy(false);
    }
  }
  async function saveAnswers() {
    setBusy(true);
    setMsg(null);
    try {
      const qa = questions
        .map((q, i) => ({ q, a: answers[i] ?? '' }))
        .filter((x) => x.a.trim());
      if (!qa.length) {
        setMsg('Answer at least one question');
        return;
      }
      const j = await post({ mode: 'interview', qa, ...scopeBody() });
      setMsg(j.ok ? `Stored ${j.stored} answer(s).` : (j.error ?? 'failed'));
      if (j.ok) {
        setQuestions([]);
        setAnswers({});
      }
    } finally {
      setBusy(false);
    }
  }

  const sel =
    'border border-border rounded bg-bg px-2 py-1 text-sm';
  return (
    <div className="border border-border rounded p-4 bg-card mt-6 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Train the Master AI</h2>
        <p className="text-xs text-fg-subtle mt-0.5">
          Teach the agent from typed knowledge, an uploaded audio
          recording, a real call, or by answering questions the
          Master asks you. Everything is embedded locally and
          retrieved into the Worker prompt on the next call.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">Source</span>
          <select
            className={sel}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setMsg(null);
            }}
          >
            <option value="text">Text knowledge</option>
            <option value="audio">Upload audio</option>
            <option value="call">From a live call</option>
            <option value="interview">Master interviews me</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">Scope</span>
          <select
            className={sel}
            value={scopeType}
            onChange={(e) => {
              setScopeType(e.target.value);
              setScopeId('');
            }}
          >
            <option value="global">Global (all AI calls)</option>
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
      </div>

      {mode === 'text' && (
        <div className="space-y-2">
          <input
            className="w-full border border-border rounded bg-bg px-2 py-1 text-sm"
            placeholder="Title (e.g. Refund policy)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="w-full border border-border rounded bg-bg px-2 py-1 text-xs"
            rows={5}
            placeholder="What should the agent know / say / do…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button
            type="button"
            disabled={busy || scopeBad}
            onClick={() => void trainText()}
            className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Train'}
          </button>
        </div>
      )}

      {mode === 'audio' && (
        <div className="space-y-2">
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-xs"
          />
          <p className="text-[11px] text-fg-subtle">
            Any audio (wav/mp3/m4a…). Transcribed locally with
            whisper — no audio leaves this box.
          </p>
          <button
            type="button"
            disabled={busy || scopeBad}
            onClick={() => void trainAudio()}
            className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Upload & transcribe'}
          </button>
        </div>
      )}

      {mode === 'call' && (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <label className="text-xs flex-1">
              <span className="block text-fg-subtle mb-1">
                Ended AI call session
              </span>
              <select
                className={`${sel} w-full`}
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              >
                <option value="">— select —</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.started_at} · {s.status} · {s.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void loadSessions()}
              className="border border-border rounded px-2 py-1 text-xs"
            >
              {busy ? '…' : 'Load'}
            </button>
          </div>
          <button
            type="button"
            disabled={busy || scopeBad || !sessionId}
            onClick={() => void trainSession()}
            className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            Train from this call
          </button>
        </div>
      )}

      {mode === 'interview' && (
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy || scopeBad}
            onClick={() => void genQuestions()}
            className="border border-border rounded px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Ask the Master for questions'}
          </button>
          {questions.length > 0 && (
            <div className="space-y-2">
              {questions.map((q, i) => (
                <div key={i}>
                  <p className="text-xs font-medium">{q}</p>
                  <textarea
                    className="w-full border border-border rounded bg-bg px-2 py-1 text-xs"
                    rows={2}
                    placeholder="Your answer (blank = skip)"
                    value={answers[i] ?? ''}
                    onChange={(e) =>
                      setAnswers({ ...answers, [i]: e.target.value })
                    }
                  />
                </div>
              ))}
              <button
                type="button"
                disabled={busy || scopeBad}
                onClick={() => void saveAnswers()}
                className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Save answers as training'}
              </button>
            </div>
          )}
        </div>
      )}

      {scopeBad && (
        <p className="text-[11px] text-warn">
          Pick a {scopeType} for the chosen scope.
        </p>
      )}
      {msg && <p className="text-xs text-fg-subtle">{msg}</p>}
    </div>
  );
}
