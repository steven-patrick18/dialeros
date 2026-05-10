'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const ROLE_DEFS: Array<{
  slug: 'web' | 'database' | 'telephony' | 'ai-worker';
  label: string;
  hint: string;
}> = [
  {
    slug: 'web',
    label: 'Web',
    hint: 'Hosts the admin GUI + control-plane Node process.',
  },
  {
    slug: 'database',
    label: 'Database',
    hint: 'Holds the SQLite (or Postgres, later) catalog.',
  },
  {
    slug: 'telephony',
    label: 'Telephony',
    hint: 'Runs FreeSWITCH; can be picked as a remote-agent bind target.',
  },
  {
    slug: 'ai-worker',
    label: 'AI worker',
    hint: 'Reserved — runs Whisper / LLM transcription jobs (future).',
  },
];

export function RolesEditor({
  nodeId,
  initialRoles,
}: {
  nodeId: string;
  initialRoles: string[];
}) {
  const router = useRouter();
  const initialSet = useMemo(() => new Set(initialRoles), [initialRoles]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialRoles),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  function toggle(slug: string) {
    setMsg(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  const dirty = useMemo(() => {
    if (selected.size !== initialSet.size) return true;
    for (const s of selected) if (!initialSet.has(s)) return true;
    return false;
  }, [selected, initialSet]);

  async function save() {
    if (selected.size === 0) {
      setMsg({ tone: 'err', text: 'Pick at least one role.' });
      return;
    }
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/cluster/nodes/${nodeId}/roles`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roles: Array.from(selected) }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setMsg({ tone: 'err', text: j.error ?? `save failed (${res.status})` });
      return;
    }
    setMsg({ tone: 'ok', text: 'Saved.' });
    router.refresh();
  }

  return (
    <div className="border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
        Roles
      </h2>
      <p className="text-xs text-fg-subtle mb-3">
        A node can wear multiple roles at once. The single-box default
        is <span className="font-mono">web + database + telephony</span>.
        Split your deploy by adding more nodes and unchecking roles here.
      </p>
      <ul className="space-y-2">
        {ROLE_DEFS.map((r) => {
          const checked = selected.has(r.slug);
          return (
            <li key={r.slug}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(r.slug)}
                  disabled={busy}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="text-fg text-sm">{r.label}</span>
                  <span className="block text-[11px] text-fg-subtle">
                    {r.hint}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3 mt-4">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save roles'}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            onClick={() => {
              setSelected(new Set(initialRoles));
              setMsg(null);
            }}
            className="text-xs text-fg-muted hover:text-fg"
          >
            Reset
          </button>
        )}
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
    </div>
  );
}
