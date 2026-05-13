'use client';

import { useState } from 'react';

export function FrequencyCapsForm({
  initial,
}: {
  initial: {
    enabled: boolean;
    lead_count: number;
    lead_window_hours: number;
    cid_count: number;
    cid_window_hours: number;
  };
}) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [leadCount, setLeadCount] = useState(initial.lead_count);
  const [leadWindowHours, setLeadWindowHours] = useState(
    initial.lead_window_hours,
  );
  const [cidCount, setCidCount] = useState(initial.cid_count);
  const [cidWindowHours, setCidWindowHours] = useState(
    initial.cid_window_hours,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/settings/frequency-caps', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          lead_count: leadCount,
          lead_window_hours: leadWindowHours,
          cid_count: cidCount,
          cid_window_hours: cidWindowHours,
        }),
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
          Enable per-lead frequency cap{' '}
          <span className="text-fg-subtle">
            (currently{' '}
            <span className={enabled ? 'text-success' : 'text-fg-muted'}>
              {enabled ? 'ON' : 'OFF'}
            </span>
            )
          </span>
        </span>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Max dials per lead</span>
          <input
            type="number"
            min={1}
            max={50}
            value={leadCount}
            onChange={(e) => setLeadCount(Number(e.target.value))}
            className="input"
            disabled={!enabled}
          />
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-fg-subtle">Window (hours)</span>
          <input
            type="number"
            min={1}
            max={720}
            value={leadWindowHours}
            onChange={(e) =>
              setLeadWindowHours(Number(e.target.value))
            }
            className="input"
            disabled={!enabled}
          />
        </label>
      </div>

      <div>
        <h3 className="text-xs uppercase tracking-wide text-fg-subtle mb-2">
          Per-CID cap (anti-robocall, iter 167)
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">Max dials per CID</span>
            <input
              type="number"
              min={1}
              max={10000}
              value={cidCount}
              onChange={(e) => setCidCount(Number(e.target.value))}
              className="input"
              disabled={!enabled}
            />
          </label>
          <label className="text-sm flex flex-col gap-1">
            <span className="text-fg-subtle">CID window (hours)</span>
            <input
              type="number"
              min={1}
              max={168}
              value={cidWindowHours}
              onChange={(e) =>
                setCidWindowHours(Number(e.target.value))
              }
              className="input"
              disabled={!enabled}
            />
          </label>
        </div>
        <p className="text-xs text-fg-subtle mt-1">
          Carrier-friendly default: 75 / 1h. Above ~100/hour single
          CIDs start getting STIR-SHAKEN flagged. Rotation strategies
          on route plans naturally cycle through pool CIDs without
          extra config — this cap kicks in only when one CID is
          getting hammered.
        </p>
      </div>

      {success ? (
        <p className="text-success text-sm">Saved.</p>
      ) : null}
      {error ? <p className="text-error text-sm">{error}</p> : null}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>

      <p className="text-xs text-fg-subtle">
        Changes apply instantly to the next pacer tick — no
        restart needed. The cap evaluates against{' '}
        <code>dial_intents.phone</code> across all campaigns; a
        lead in multiple lists / campaigns still counts as one
        phone for the cap.
      </p>
    </div>
  );
}
