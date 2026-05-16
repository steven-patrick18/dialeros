'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Persona {
  id: string;
  name: string;
  enabled: number;
  system_prompt: string;
  greeting: string;
  agent_name: string | null;
  agent_title: string | null;
  llm_model: string;
  stt_model: string;
  tts_engine: string;
  tts_voice: string | null;
  max_turns: number;
  max_call_seconds: number;
  escalation_keywords_json: string;
}

interface StackHealth {
  ollama: { up: boolean; models: string[]; detail?: string };
  coqui: { up: boolean; detail?: string };
}

type TestResult =
  | { ok: true; reply: string; model: string; latency_ms: number }
  | { ok: false; reason: string; detail: string };

const STT_MODELS = [
  'tiny.en',
  'base.en',
  'small.en',
  'medium.en',
] as const;

const BLANK = {
  name: '',
  agent_name: '',
  agent_title: '',
  system_prompt:
    'You are a friendly outbound appointment-setting agent for Acme Roofing. Keep replies under 2 sentences. Never claim to be human if asked directly. If the caller is hostile or asks to be removed, acknowledge and end politely.',
  greeting:
    'Hi, this is the Acme Roofing scheduling line — do you have a quick minute?',
  llm_model: 'qwen2.5:3b',
  stt_model: 'base.en',
  tts_engine: 'piper',
  tts_voice: '',
  max_turns: 20,
  max_call_seconds: 300,
  escalation_keywords: 'human, lawyer, stop calling, remove me',
};

export function AiPersonasClient({
  initialRows,
}: {
  initialRows: Persona[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Persona[]>(initialRows);
  const [health, setHealth] = useState<StackHealth | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Sandbox state.
  const [custLine, setCustLine] = useState('');
  const [convo, setConvo] = useState<
    Array<{ role: 'assistant' | 'user'; content: string }>
  >([]);
  const [testing, setTesting] = useState(false);
  const [testErr, setTestErr] = useState<string | null>(null);

  const loadHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/stack-health', {
        credentials: 'same-origin',
      });
      if (res.ok) setHealth((await res.json()) as StackHealth);
    } catch {
      /* banner just won't render */
    }
  }, []);
  useEffect(() => {
    void loadHealth();
  }, [loadHealth]);

  function resetForm() {
    setForm({ ...BLANK });
    setEditingId(null);
    setConvo([]);
    setCustLine('');
    setTestErr(null);
  }

  function loadInto(p: Persona) {
    setEditingId(p.id);
    let kw: string[] = [];
    try {
      kw = JSON.parse(p.escalation_keywords_json) as string[];
    } catch {
      /* ignore */
    }
    setForm({
      name: p.name,
      agent_name: p.agent_name ?? '',
      agent_title: p.agent_title ?? '',
      system_prompt: p.system_prompt,
      greeting: p.greeting,
      llm_model: p.llm_model,
      stt_model: p.stt_model,
      tts_engine: p.tts_engine,
      tts_voice: p.tts_voice ?? '',
      max_turns: p.max_turns,
      max_call_seconds: p.max_call_seconds,
      escalation_keywords: kw.join(', '),
    });
    setConvo([]);
  }

  function payload() {
    return {
      name: form.name,
      agent_name: form.agent_name || null,
      agent_title: form.agent_title || null,
      system_prompt: form.system_prompt,
      greeting: form.greeting,
      llm_model: form.llm_model,
      stt_model: form.stt_model,
      tts_engine: form.tts_engine,
      tts_voice: form.tts_voice || null,
      max_turns: Number(form.max_turns) || 20,
      max_call_seconds: Number(form.max_call_seconds) || 300,
      escalation_keywords: form.escalation_keywords
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const url = editingId
        ? `/api/settings/ai-personas/${editingId}`
        : '/api/settings/ai-personas';
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload()),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `HTTP ${res.status}`);
        return;
      }
      resetForm();
      router.refresh();
      const lr = await fetch('/api/settings/ai-personas', {
        credentials: 'same-origin',
      });
      if (lr.ok) setRows(((await lr.json()) as { rows: Persona[] }).rows);
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm('Delete this persona?')) return;
    const res = await fetch(`/api/settings/ai-personas/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (res.ok) {
      setRows((p) => p.filter((x) => x.id !== id));
      if (editingId === id) resetForm();
    }
  }

  async function runTurn() {
    if (!custLine.trim()) return;
    setTesting(true);
    setTestErr(null);
    const line = custLine.trim();
    try {
      const res = await fetch('/api/ai/persona-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          system_prompt: form.system_prompt,
          greeting: form.greeting,
          agent_name: form.agent_name || null,
          agent_title: form.agent_title || null,
          model: form.llm_model,
          history: convo,
          customer_line: line,
        }),
      });
      const data = (await res.json()) as TestResult;
      if (!data.ok) {
        setTestErr(`${data.reason}: ${data.detail}`);
        return;
      }
      setConvo((c) => [
        ...c,
        { role: 'user', content: line },
        { role: 'assistant', content: data.reply },
      ]);
      setCustLine('');
    } catch (e) {
      setTestErr((e as Error).message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-6">
      {health && (
        <div
          className={
            health.ollama.up
              ? 'border border-success/40 bg-success/10 rounded p-3 text-xs'
              : 'border border-warn/40 bg-warn/10 rounded p-3 text-xs'
          }
        >
          <div>
            <strong>LLM (Ollama):</strong>{' '}
            {health.ollama.up ? (
              <span className="text-success">
                up — models: {health.ollama.models.join(', ') || '(none pulled)'}
              </span>
            ) : (
              <span className="text-warn">
                offline ({health.ollama.detail ?? 'unreachable'}) — install
                via scripts/install-ai-stack.sh; the sandbox + live AI
                loop need this.
              </span>
            )}
          </div>
          <div className="mt-1">
            <strong>TTS (Coqui XTTS-v2):</strong>{' '}
            {health.coqui.up ? (
              <span className="text-success">up</span>
            ) : (
              <span className="text-warn">
                offline ({health.coqui.detail ?? 'unreachable'})
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Editor */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">
            {editingId ? 'Edit persona' : 'New persona'}
          </h2>
          <input
            className="w-full border border-border rounded bg-bg px-2 py-1 text-sm"
            placeholder="Persona name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="border border-border rounded bg-bg px-2 py-1 text-sm"
              placeholder="Agent name it states (e.g. Sarah)"
              value={form.agent_name}
              onChange={(e) =>
                setForm({ ...form, agent_name: e.target.value })
              }
            />
            <input
              className="border border-border rounded bg-bg px-2 py-1 text-sm"
              placeholder="Designation (e.g. Senior Advisor)"
              value={form.agent_title}
              onChange={(e) =>
                setForm({ ...form, agent_title: e.target.value })
              }
            />
          </div>
          <textarea
            className="w-full border border-border rounded bg-bg px-2 py-1 text-xs font-mono"
            rows={6}
            placeholder="System prompt"
            value={form.system_prompt}
            onChange={(e) =>
              setForm({ ...form, system_prompt: e.target.value })
            }
          />
          <textarea
            className="w-full border border-border rounded bg-bg px-2 py-1 text-xs"
            rows={2}
            placeholder="Greeting (first line spoken)"
            value={form.greeting}
            onChange={(e) => setForm({ ...form, greeting: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              className="border border-border rounded bg-bg px-2 py-1 text-xs font-mono"
              value={form.llm_model}
              onChange={(e) =>
                setForm({ ...form, llm_model: e.target.value })
              }
            >
              {(health?.ollama.models?.length
                ? health.ollama.models
                : [form.llm_model || 'qwen2.5:3b']
              ).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              className="border border-border rounded bg-bg px-2 py-1 text-xs font-mono"
              value={form.stt_model}
              onChange={(e) =>
                setForm({ ...form, stt_model: e.target.value })
              }
            >
              {STT_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <select
              className="border border-border rounded bg-bg px-2 py-1 text-xs"
              value={form.tts_engine}
              onChange={(e) =>
                setForm({ ...form, tts_engine: e.target.value })
              }
            >
              <option value="piper">piper</option>
              <option value="coqui">coqui (cloned)</option>
            </select>
            <input
              className="border border-border rounded bg-bg px-2 py-1 text-xs font-mono"
              placeholder="tts_voice"
              value={form.tts_voice}
              onChange={(e) =>
                setForm({ ...form, tts_voice: e.target.value })
              }
            />
            <input
              type="number"
              className="border border-border rounded bg-bg px-2 py-1 text-xs"
              placeholder="max_turns"
              value={form.max_turns}
              onChange={(e) =>
                setForm({ ...form, max_turns: Number(e.target.value) })
              }
            />
            <input
              type="number"
              className="border border-border rounded bg-bg px-2 py-1 text-xs"
              placeholder="max_call_seconds"
              value={form.max_call_seconds}
              onChange={(e) =>
                setForm({
                  ...form,
                  max_call_seconds: Number(e.target.value),
                })
              }
            />
          </div>
          <input
            className="w-full border border-border rounded bg-bg px-2 py-1 text-xs"
            placeholder="escalation keywords (comma-separated)"
            value={form.escalation_keywords}
            onChange={(e) =>
              setForm({ ...form, escalation_keywords: e.target.value })
            }
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !form.name.trim()}
              className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
            >
              {busy ? 'Saving…' : editingId ? 'Update' : 'Create'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-fg-subtle hover:text-fg text-sm px-2"
              >
                Cancel
              </button>
            )}
            {err && <span className="text-error text-xs self-center">{err}</span>}
          </div>
        </div>

        {/* Sandbox */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">
            Text sandbox{' '}
            <span className="text-fg-subtle font-normal">
              — tune the prompt against the live LLM
            </span>
          </h2>
          <div className="h-64 overflow-y-auto border border-border rounded bg-card/60 p-2 text-xs space-y-2">
            <div className="text-fg-subtle italic">
              AI opens: &ldquo;{form.greeting}&rdquo;
            </div>
            {convo.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === 'assistant'
                    ? 'text-accent'
                    : 'text-fg'
                }
              >
                <span className="text-fg-subtle">
                  {m.role === 'assistant' ? 'AI' : 'Caller'}:
                </span>{' '}
                {m.content}
              </div>
            ))}
            {testing && (
              <div className="text-fg-subtle">AI thinking…</div>
            )}
          </div>
          {testErr && (
            <p className="text-warn text-xs">{testErr}</p>
          )}
          <div className="flex gap-2">
            <input
              className="flex-1 border border-border rounded bg-bg px-2 py-1 text-sm"
              placeholder="Type a caller line…"
              value={custLine}
              onChange={(e) => setCustLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runTurn();
              }}
            />
            <button
              type="button"
              onClick={() => void runTurn()}
              disabled={testing || !custLine.trim()}
              className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
            >
              Send
            </button>
          </div>
          {convo.length > 0 && (
            <button
              type="button"
              onClick={() => setConvo([])}
              className="text-fg-subtle hover:text-fg text-xs"
            >
              Reset conversation
            </button>
          )}
        </div>
      </div>

      {/* Saved personas */}
      <div>
        <h2 className="text-sm font-semibold mb-2">
          Personas ({rows.length})
        </h2>
        {rows.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            None yet. Build one above + test it in the sandbox.
          </p>
        ) : (
          <table className="w-full text-sm border border-border rounded">
            <thead className="bg-card">
              <tr className="text-left">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2">TTS</th>
                <th className="px-3 py-2">Guardrails</th>
                <th className="px-3 py-2">Enabled</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.llm_model}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.tts_engine}
                    {p.tts_voice ? `:${p.tts_voice}` : ''}
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-subtle">
                    {p.max_turns}t / {p.max_call_seconds}s
                  </td>
                  <td className="px-3 py-2">
                    {p.enabled ? (
                      <span className="text-success text-xs">on</span>
                    ) : (
                      <span className="text-fg-muted text-xs">off</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-xs space-x-2">
                    <button
                      type="button"
                      onClick={() => loadInto(p)}
                      className="text-link hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void del(p.id)}
                      className="text-error hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
