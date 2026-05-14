'use client';

import { useState } from 'react';

export function QueueAnnounceToggle({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function save(next: boolean) {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/settings/queue-announce', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { enabled: boolean };
      setEnabled(data.enabled);
      setSuccess(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-border rounded p-4 bg-card space-y-3">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => void save(e.target.checked)}
          disabled={saving}
          className="h-4 w-4"
        />
        <span className="text-sm">
          Announce position to queued callers{' '}
          <span className="text-fg-subtle">
            (currently{' '}
            <span className={enabled ? 'text-success' : 'text-fg-muted'}>
              {enabled ? 'ON' : 'OFF'}
            </span>
            )
          </span>
        </span>
      </label>
      {success ? (
        <p className="text-success text-xs">Saved.</p>
      ) : null}
      {error ? <p className="text-error text-xs">{error}</p> : null}
      <p className="text-xs text-fg-subtle">
        Takes effect on the very next poll iteration — already
        parked callers will hear the announcement at the next
        3-second poll tick. No FS reload required.
      </p>
    </div>
  );
}
