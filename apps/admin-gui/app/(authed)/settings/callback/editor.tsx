'use client';

import { useState } from 'react';

interface Props {
  initial: { enabled: boolean; digit: string; ttlMinutes: number };
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'];

export function CallbackEditor({ initial }: Props) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [digit, setDigit] = useState(initial.digit);
  const [ttlMinutes, setTtlMinutes] = useState(initial.ttlMinutes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/settings/callback', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, digit, ttlMinutes }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? `HTTP ${res.status}`);
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
    <div className="border border-border rounded p-4 bg-card space-y-4">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm">
          Enable inbound callback{' '}
          <span className="text-fg-subtle">
            (currently{' '}
            <span className={enabled ? 'text-success' : 'text-fg-muted'}>
              {enabled ? 'ON' : 'OFF'}
            </span>
            )
          </span>
        </span>
      </label>

      <div>
        <label className="text-sm block mb-1">
          Callback DTMF digit
        </label>
        <select
          value={digit}
          onChange={(e) => setDigit(e.target.value)}
          className="border border-border rounded bg-bg px-2 py-1 text-sm"
        >
          {DIGITS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <p className="text-xs text-fg-subtle mt-1">
          The digit callers press while on hold to request a
          callback. Default is 9.
        </p>
      </div>

      <div>
        <label className="text-sm block mb-1">
          Pending callback TTL (minutes)
        </label>
        <input
          type="number"
          min={1}
          max={1440}
          value={ttlMinutes}
          onChange={(e) =>
            setTtlMinutes(Number.parseInt(e.target.value, 10) || 60)
          }
          className="border border-border rounded bg-bg px-2 py-1 text-sm w-24"
        />
        <p className="text-xs text-fg-subtle mt-1">
          A pending callback older than this gets auto-expired
          when the sweeper next runs. Default 60.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {success ? (
          <span className="text-success text-xs">Saved.</span>
        ) : null}
        {error ? <span className="text-error text-xs">{error}</span> : null}
      </div>
    </div>
  );
}
