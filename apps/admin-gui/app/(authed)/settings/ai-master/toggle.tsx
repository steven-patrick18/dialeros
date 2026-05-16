'use client';

import { useState } from 'react';

export function MasterToggle({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const [on, setOn] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch('/api/settings/ai-master', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ enabled: next }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setMsg(j.error ?? `HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as { enabled: boolean };
      setOn(j.enabled);
      setMsg('Saved.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded p-4 bg-card">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={on}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm">
          Master AI{' '}
          <span className={on ? 'text-success' : 'text-fg-muted'}>
            {on ? 'enabled' : 'disabled'}
          </span>
          <span className="block text-xs text-fg-subtle mt-0.5">
            Skeleton until iters 200+ wire memory/learning. Safe
            to leave off; has no effect on the iter-195 Worker
            loop yet.
          </span>
        </span>
      </label>
      {msg && <p className="text-xs text-fg-subtle mt-2">{msg}</p>}
    </div>
  );
}
