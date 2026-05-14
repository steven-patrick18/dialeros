'use client';

import { useState } from 'react';

// Iter 175 — Reusable skill chip editor. Used on /users/[id]
// (per-user skills) and on /campaigns/[id] (required skills).
// The submit endpoint is passed via prop so the same component
// drives both.

export function SkillEditor({
  initial,
  endpoint,
  fieldName = 'skills',
  label,
  helpText,
}: {
  initial: string[];
  endpoint: string;
  fieldName?: string;
  label: string;
  helpText?: string;
}) {
  const [skills, setSkills] = useState<string[]>([...initial]);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function addDraft() {
    const code = draft.trim().toUpperCase();
    if (!code) return;
    if (!/^[A-Z0-9_-]+$/.test(code)) {
      setError(`Bad skill code "${code}" — use UPPER / digits / _ / -`);
      return;
    }
    if (skills.includes(code)) {
      setDraft('');
      return;
    }
    setSkills((s) => [...s, code]);
    setDraft('');
    setError(null);
  }

  function remove(skill: string) {
    setSkills((s) => s.filter((x) => x !== skill));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ [fieldName]: skills }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          details?: unknown;
        };
        setError(
          data.error
            ? `${data.error}${data.details ? ' — ' + JSON.stringify(data.details) : ''}`
            : `HTTP ${res.status}`,
        );
        return;
      }
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-medium mb-1">{label}</div>
        {helpText ? (
          <p className="text-xs text-fg-subtle mb-2">{helpText}</p>
        ) : null}
        <div className="flex flex-wrap gap-1.5 mb-2 min-h-[2rem]">
          {skills.length === 0 ? (
            <span className="text-xs text-fg-subtle">No skills set.</span>
          ) : (
            skills.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 px-2 py-0.5 border border-border rounded bg-card-hover text-xs font-mono"
              >
                {s}
                <button
                  type="button"
                  onClick={() => remove(s)}
                  className="text-fg-subtle hover:text-error"
                  aria-label={`Remove ${s}`}
                >
                  ✕
                </button>
              </span>
            ))
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addDraft();
              }
            }}
            className="input flex-1 font-mono text-xs"
            placeholder="SPANISH"
          />
          <button
            type="button"
            onClick={addDraft}
            className="text-sm bg-card-hover hover:bg-card-hover/70 px-3 py-1.5 rounded"
          >
            + Add
          </button>
        </div>
      </div>

      {success ? <p className="text-success text-sm">Saved.</p> : null}
      {error ? <p className="text-error text-sm">{error}</p> : null}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
