'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Config {
  enabled: boolean;
  min_sample: number;
  win_rate_floor: number;
  pdd_ceiling_ms: number;
  cooldown_minutes: number;
}

interface PausedRow {
  id: string;
  name: string;
  race_paused_until: string;
}

interface Props {
  initial: Config;
  pausedRows: PausedRow[];
}

export function AutoPruneEditor({ initial, pausedRows }: Props) {
  const router = useRouter();
  const [cfg, setCfg] = useState<Config>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/settings/carrier-race-auto-prune', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(cfg),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      setSuccess(true);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function resume(id: string) {
    const res = await fetch(`/api/carriers/${id}/race-resume`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `HTTP ${res.status}`);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded p-4 bg-card space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
            className="h-4 w-4"
          />
          <span>
            Enable auto-prune (currently{' '}
            <span className={cfg.enabled ? 'text-success' : 'text-fg-muted'}>
              {cfg.enabled ? 'ON' : 'OFF'}
            </span>
            )
          </span>
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-fg-subtle mb-1">
              Minimum sample
            </label>
            <input
              type="number"
              min={1}
              max={10000}
              value={cfg.min_sample}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  min_sample: Number.parseInt(e.target.value, 10) || 20,
                })
              }
              className="w-full border border-border rounded bg-bg px-2 py-1 text-sm tabular-nums"
            />
            <p className="text-xs text-fg-subtle mt-1">
              Races required before evaluating. Below this we keep
              the carrier in the rotation.
            </p>
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">
              Win-rate floor (0–1)
            </label>
            <input
              type="number"
              step="0.01"
              min={0}
              max={1}
              value={cfg.win_rate_floor}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  win_rate_floor: Number.parseFloat(e.target.value) || 0,
                })
              }
              className="w-full border border-border rounded bg-bg px-2 py-1 text-sm tabular-nums"
            />
            <p className="text-xs text-fg-subtle mt-1">
              {(cfg.win_rate_floor * 100).toFixed(0)}% — below this
              triggers a pause.
            </p>
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">
              PDD ceiling (ms)
            </label>
            <input
              type="number"
              min={100}
              max={60000}
              value={cfg.pdd_ceiling_ms}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  pdd_ceiling_ms: Number.parseInt(e.target.value, 10) || 4000,
                })
              }
              className="w-full border border-border rounded bg-bg px-2 py-1 text-sm tabular-nums"
            />
            <p className="text-xs text-fg-subtle mt-1">
              Avg-PDD above this triggers a pause (needs
              min-sample of WON races).
            </p>
          </div>
          <div>
            <label className="block text-xs text-fg-subtle mb-1">
              Cooldown (minutes)
            </label>
            <input
              type="number"
              min={1}
              max={1440}
              value={cfg.cooldown_minutes}
              onChange={(e) =>
                setCfg({
                  ...cfg,
                  cooldown_minutes:
                    Number.parseInt(e.target.value, 10) || 30,
                })
              }
              className="w-full border border-border rounded bg-bg px-2 py-1 text-sm tabular-nums"
            />
            <p className="text-xs text-fg-subtle mt-1">
              How long a paused carrier stays out of the race
              rotation.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {success && (
            <span className="text-success text-xs">Saved.</span>
          )}
          {error && <span className="text-error text-xs">{error}</span>}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2">
          Currently paused ({pausedRows.length})
        </h2>
        {pausedRows.length === 0 ? (
          <p className="text-sm text-fg-subtle">
            No carriers currently paused.
          </p>
        ) : (
          <table className="w-full text-sm border border-border rounded">
            <thead className="bg-card">
              <tr className="text-left">
                <th className="px-3 py-2">Carrier</th>
                <th className="px-3 py-2">Until</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {pausedRows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {r.name}{' '}
                    <span className="font-mono text-xs text-fg-subtle">
                      {r.id}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {new Date(r.race_paused_until).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => void resume(r.id)}
                      className="text-link hover:underline text-xs"
                    >
                      Resume now
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
