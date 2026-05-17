'use client';

import { useCallback, useEffect, useState } from 'react';

interface Prov {
  kind: string;
  base_url: string;
  model_override: string;
  api_key_set: boolean;
}

export function LlmProviderPanel() {
  const [p, setP] = useState<Prov>({
    kind: 'ollama',
    base_url: 'http://127.0.0.1:11434',
    model_override: '',
    api_key_set: false,
  });
  const [apiKey, setApiKey] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch('/api/ai/llm-provider', {
      credentials: 'same-origin',
    });
    if (r.ok)
      setP(((await r.json()) as { provider: Prov }).provider);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = {
        kind: p.kind,
        base_url: p.base_url,
        model_override: p.model_override,
      };
      if (apiKey) body.api_key = apiKey;
      const r = await fetch('/api/ai/llm-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!r.ok) {
        setMsg(j.error ?? `HTTP ${r.status}`);
        return;
      }
      setMsg('Saved.');
      setApiKey('');
      await load();
    } finally {
      setBusy(false);
    }
  }

  const inp =
    'border border-border rounded bg-bg px-2 py-1 text-sm';
  return (
    <div className="border border-border rounded p-4 bg-card mt-6 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">LLM provider</h2>
        <p className="text-xs text-fg-subtle mt-0.5">
          The local inference engine for the Worker loop, sandbox
          + QA. Default is Ollama on this box. For future
          hardware you can point at a local OpenAI-compatible
          server (llama.cpp-server / vLLM). A non-local URL is
          rejected — DialerOS never calls an external service.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">Transport</span>
          <select
            className={inp}
            value={p.kind}
            onChange={(e) => setP({ ...p, kind: e.target.value })}
          >
            <option value="ollama">Ollama (default)</option>
            <option value="openai_compat">
              OpenAI-compatible (local)
            </option>
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">
            Base URL (local only)
          </span>
          <input
            className={`${inp} w-64`}
            value={p.base_url}
            onChange={(e) =>
              setP({ ...p, base_url: e.target.value })
            }
            placeholder="http://127.0.0.1:11434"
          />
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">
            Model override (optional)
          </span>
          <input
            className={`${inp} w-48`}
            value={p.model_override}
            onChange={(e) =>
              setP({ ...p, model_override: e.target.value })
            }
            placeholder="(use persona model)"
          />
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">
            API key {p.api_key_set ? '(set — blank keeps it)' : '(optional, local)'}
          </span>
          <input
            type="password"
            className={`${inp} w-48`}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={p.api_key_set ? '••••••' : 'none'}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save provider'}
        </button>
        {msg && (
          <span className="text-xs text-fg-subtle">{msg}</span>
        )}
      </div>
    </div>
  );
}
