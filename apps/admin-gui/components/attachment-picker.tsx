'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AttachmentItem {
  id: string;
  name: string;
  hint?: string; // shown after the name in muted text
  warn?: boolean; // dim the row to flag (e.g. disabled item)
}

/**
 * Iter 24/27 — ViciDial-style inline multi-select picker. Renders a
 * checkbox list with a single Save button. The button only enables when
 * the selection diverges from the initial set, and POSTs/PUTs the full
 * desired set to `endpoint` under `bodyKey`.
 *
 * Used by:
 *   - campaign in-groups + lead-lists (POST /api/campaigns/[id]/...)
 *   - route-plan failover carriers     (PUT /api/route-plans/[id])
 */
export function AttachmentPicker({
  endpoint,
  bodyKey,
  options,
  initialSelected,
  emptyMessage,
  method = 'POST',
}: {
  endpoint: string;
  bodyKey: string;
  options: AttachmentItem[];
  initialSelected: string[];
  emptyMessage?: string;
  method?: 'POST' | 'PUT' | 'PATCH';
}) {
  const router = useRouter();
  const initialSet = useMemo(() => new Set(initialSelected), [initialSelected]);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(
    null,
  );

  const dirty = useMemo(() => {
    if (selected.size !== initialSet.size) return true;
    for (const id of selected) if (!initialSet.has(id)) return true;
    return false;
  }, [selected, initialSet]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [bodyKey]: [...selected] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({
          tone: 'err',
          text: j.error ?? `save failed (${res.status})`,
        });
        return;
      }
      setMsg({ tone: 'ok', text: 'Saved.' });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setSelected(new Set(initialSelected));
    setMsg(null);
  }

  return (
    <div className="space-y-3">
      {options.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          {emptyMessage ?? 'Nothing to attach yet.'}
        </p>
      ) : (
        <ul className="max-h-72 overflow-y-auto border border-border rounded divide-y divide-border/50">
          {options.map((o) => {
            const checked = selected.has(o.id);
            return (
              <li
                key={o.id}
                className={`flex items-center gap-3 px-3 py-2 text-sm hover:bg-card-hover ${
                  o.warn ? 'opacity-70' : ''
                }`}
              >
                <input
                  id={`attach-${o.id}`}
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(o.id)}
                  className="cursor-pointer"
                />
                <label
                  htmlFor={`attach-${o.id}`}
                  className="flex-1 cursor-pointer"
                >
                  <span className={o.warn ? 'text-fg-muted' : 'text-fg'}>
                    {o.name}
                  </span>
                  {o.hint && (
                    <span className="text-fg-subtle text-xs ml-2">
                      {o.hint}
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || busy}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        {dirty && !busy && (
          <button
            type="button"
            onClick={reset}
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
