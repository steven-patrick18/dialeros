'use client';

import { useEffect, useState } from 'react';

interface Cfg {
  reply_length?: string;
  temperature?: number;
  keep_warm?: boolean;
  prompt_budget_chars?: number;
  tts_speed?: number;
}

export function PerfPanel() {
  const [cfg, setCfg] = useState<Cfg>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      const r = await fetch('/api/ai/perf', {
        credentials: 'same-origin',
      });
      if (r.ok)
        setCfg(((await r.json()) as { config: Cfg }).config ?? {});
    })();
  }, []);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/ai/perf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(cfg),
      });
      setMsg(r.ok ? 'Saved.' : `HTTP ${r.status}`);
    } finally {
      setBusy(false);
    }
  }

  const sel =
    'border border-border rounded bg-bg px-2 py-1 text-sm';
  return (
    <div className="border border-border rounded p-4 bg-card mt-6 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">AI performance</h2>
        <p className="text-xs text-fg-subtle mt-0.5">
          Latency / quality knobs for the live Worker loop on this
          (CPU) box. Defaults = pre-207 behaviour exactly; tune
          for speed. Takes effect on the next AI turn.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">
            Reply length
          </span>
          <select
            className={sel}
            value={cfg.reply_length ?? 'uncapped'}
            onChange={(e) =>
              setCfg({ ...cfg, reply_length: e.target.value })
            }
          >
            <option value="short">Short (~96 tok, fastest)</option>
            <option value="medium">Medium (~192 tok)</option>
            <option value="long">Long (~384 tok)</option>
            <option value="uncapped">Uncapped (pre-207)</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">Creativity</span>
          <select
            className={sel}
            value={String(cfg.temperature ?? 0.6)}
            onChange={(e) =>
              setCfg({ ...cfg, temperature: Number(e.target.value) })
            }
          >
            <option value="0.3">Focused (0.3)</option>
            <option value="0.6">Balanced (0.6)</option>
            <option value="0.9">Creative (0.9)</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">
            Keep model warm
          </span>
          <select
            className={sel}
            value={cfg.keep_warm ? 'on' : 'off'}
            onChange={(e) =>
              setCfg({ ...cfg, keep_warm: e.target.value === 'on' })
            }
          >
            <option value="off">Off (pre-207)</option>
            <option value="on">On (resident 30m)</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">
            Prompt budget
          </span>
          <select
            className={sel}
            value={String(cfg.prompt_budget_chars ?? 0)}
            onChange={(e) =>
              setCfg({
                ...cfg,
                prompt_budget_chars: Number(e.target.value),
              })
            }
          >
            <option value="0">Off (pre-207)</option>
            <option value="4000">~4k chars</option>
            <option value="6000">~6k chars</option>
            <option value="8000">~8k chars</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-fg-subtle mb-1">TTS speed</span>
          <select
            className={sel}
            value={String(cfg.tts_speed ?? 1)}
            onChange={(e) =>
              setCfg({ ...cfg, tts_speed: Number(e.target.value) })
            }
          >
            <option value="0.9">0.9x (slower)</option>
            <option value="1">1.0x (default)</option>
            <option value="1.1">1.1x</option>
            <option value="1.2">1.2x (snappier)</option>
          </select>
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {msg && (
          <span className="text-xs text-fg-subtle">{msg}</span>
        )}
      </div>
    </div>
  );
}
