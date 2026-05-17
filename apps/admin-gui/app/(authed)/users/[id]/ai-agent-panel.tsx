'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PersonaOpt {
  id: string;
  name: string;
  enabled: number;
}

// Iter 210 — bind / change the Worker-AI persona for an EXISTING
// user. Previously a persona could only be set at user creation
// (no edit-time control, and the PATCH path dropped the boolean)
// — so an AI agent could never be (re)assigned. Admin only.
export function AiAgentPanel({
  userId,
  isAdmin,
  initialIsAi,
  initialPersonaId,
  personas,
}: {
  userId: string;
  isAdmin: boolean;
  initialIsAi: boolean;
  initialPersonaId: string | null;
  personas: PersonaOpt[];
}) {
  const router = useRouter();
  const [isAi, setIsAi] = useState(initialIsAi);
  const [personaId, setPersonaId] = useState(initialPersonaId ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{
    tone: 'ok' | 'err';
    text: string;
  } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        is_ai_agent: isAi,
        ai_persona_id: isAi ? personaId || null : null,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setMsg({
        tone: 'err',
        text: j.error ?? `save failed (${res.status})`,
      });
      return;
    }
    setMsg({ tone: 'ok', text: 'Saved.' });
    router.refresh();
  }

  if (!isAdmin) {
    return (
      <p className="text-xs text-fg-subtle">
        {initialIsAi
          ? `AI agent${
              initialPersonaId
                ? ` — persona ${
                    personas.find((p) => p.id === initialPersonaId)
                      ?.name ?? initialPersonaId
                  }`
                : ' (no persona bound)'
            }`
          : 'Human account.'}{' '}
        Admin role required to change.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-fg-subtle">
        An AI agent is a Worker AI driven by a persona. It never
        logs in; assign it to in-groups / campaigns exactly like a
        human. The persona supplies its name, designation, script
        and voice (manage on{' '}
        <a
          href="/settings/ai-personas"
          className="text-link hover:underline"
        >
          AI personas
        </a>
        ).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-fg-subtle mb-1">
            Account type
          </span>
          <select
            value={isAi ? 'ai' : 'human'}
            disabled={busy}
            onChange={(e) => {
              setMsg(null);
              setIsAi(e.target.value === 'ai');
            }}
            className="border border-border rounded bg-bg px-2 py-1 text-sm"
          >
            <option value="human">Human</option>
            <option value="ai">AI agent</option>
          </select>
        </label>
        {isAi && (
          <label className="text-sm">
            <span className="block text-xs text-fg-subtle mb-1">
              Worker AI persona
            </span>
            <select
              value={personaId}
              disabled={busy}
              onChange={(e) => {
                setMsg(null);
                setPersonaId(e.target.value);
              }}
              className="border border-border rounded bg-bg px-2 py-1 text-sm"
            >
              <option value="">— select a persona —</option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.enabled ? '' : ' (disabled)'}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || (isAi && !personaId)}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {msg && (
          <span
            className={`text-xs ${
              msg.tone === 'ok' ? 'text-success' : 'text-error'
            }`}
          >
            {msg.text}
          </span>
        )}
      </div>
      {isAi && !personaId && (
        <p className="text-xs text-warn">
          Pick a persona — an AI agent with no persona can't take
          calls. Disabled personas appear but won't go live until
          enabled on the AI personas page.
        </p>
      )}
    </div>
  );
}
