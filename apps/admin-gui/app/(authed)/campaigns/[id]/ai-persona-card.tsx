'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PersonaOpt {
  id: string;
  name: string;
  enabled: number;
}
interface Props {
  campaignId: string;
  personas: PersonaOpt[];
  initial: {
    ai_persona_id: string | null;
    ai_persona_id_b: string | null;
    ai_ab_pct: number;
  };
}

// Iter 198 — Bind an AI persona to the campaign + optional A/B
// challenger. The pacer routes answered legs to the AI agent
// only when ai.live_enabled is ON (master switch on
// /reports/ai-calls) AND a persona is bound here AND it's
// enabled. B + split% runs the experiment; results compare on
// /reports/ai-calls.

export function AiPersonaCard({ campaignId, personas, initial }: Props) {
  const router = useRouter();
  const [a, setA] = useState(initial.ai_persona_id ?? '');
  const [b, setB] = useState(initial.ai_persona_id_b ?? '');
  const [pct, setPct] = useState(initial.ai_ab_pct ?? 0);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          ai_persona_id: a || null,
          ai_persona_id_b: b || null,
          ai_ab_pct: b ? pct : 0,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setMsg({ ok: false, text: j.error ?? `HTTP ${res.status}` });
        return;
      }
      setMsg({ ok: true, text: 'Saved.' });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-border rounded p-4 mb-6 max-w-3xl">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
        AI agent (Phase K)
      </h2>
      <p className="text-xs text-fg-subtle mb-3">
        Bind a persona to drive answered calls instead of a human.
        Requires the master switch on{' '}
        <a
          href="/reports/ai-calls"
          className="text-link hover:underline"
        >
          /reports/ai-calls
        </a>{' '}
        + a compiled mod_audio_stream. Add a B persona + split %
        to A/B test; results compare on the same page.
      </p>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-fg-subtle mb-1">
            Persona A
          </label>
          <select
            value={a}
            onChange={(e) => setA(e.target.value)}
            className="border border-border rounded bg-bg px-2 py-1 text-sm w-full max-w-sm"
          >
            <option value="">— none (use human agents) —</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.enabled ? '' : ' (disabled)'}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-fg-subtle mb-1">
            Persona B (A/B challenger — optional)
          </label>
          <select
            value={b}
            onChange={(e) => setB(e.target.value)}
            disabled={!a}
            className="border border-border rounded bg-bg px-2 py-1 text-sm w-full max-w-sm disabled:opacity-50"
          >
            <option value="">— no experiment —</option>
            {personas
              .filter((p) => p.id !== a)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.enabled ? '' : ' (disabled)'}
                </option>
              ))}
          </select>
        </div>
        {b && (
          <div>
            <label className="block text-xs text-fg-subtle mb-1">
              % of AI calls to B: {pct}%
            </label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="w-full max-w-sm"
            />
            <p className="text-xs text-fg-subtle mt-1">
              {100 - pct}% → A · {pct}% → B
            </p>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {msg && (
            <span
              className={`text-xs ${
                msg.ok ? 'text-success' : 'text-error'
              }`}
            >
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
