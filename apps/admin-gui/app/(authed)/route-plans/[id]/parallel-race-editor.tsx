'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CarrierOpt {
  id: string;
  name: string;
}

interface Props {
  planId: string;
  carriers: CarrierOpt[];
  initialEnabled: boolean;
  initialCarrierIds: string[];
}

// Iter 183 — Parallel race-to-answer editor. Two-to-four carriers
// race the same INVITE; first to 200 OK wins. VOICEMAIL-DROP /
// AUDIO-DROP campaigns only — the pacer enforces this, but the
// UI warns up front.

export function ParallelRaceEditor({
  planId,
  carriers,
  initialEnabled,
  initialCarrierIds,
}: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [selected, setSelected] = useState<string[]>(initialCarrierIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function toggleCarrier(cid: string) {
    setSelected((prev) => {
      if (prev.includes(cid)) return prev.filter((x) => x !== cid);
      if (prev.length >= 4) return prev; // cap at 4
      return [...prev, cid];
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/route-plans/${planId}/parallel-race`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          enabled,
          carrier_ids: selected,
        }),
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

  return (
    <div className="border border-border rounded p-4 bg-card space-y-4">
      <div>
        <h2 className="text-sm font-semibold mb-1">
          Parallel race-to-answer (iter 183)
        </h2>
        <p className="text-xs text-fg-subtle">
          Race the same INVITE across 2–4 carriers simultaneously
          on each call; whichever returns 200 OK first wins, the
          others get CANCEL&apos;d. Reduces post-dial delay
          variance for voicemail-drop traffic. <strong className="text-warn">
            Voicemail-drop / audio-drop campaigns only
          </strong>{' '}
          — the pacer refuses to race live-agent campaigns
          (dual-ringing a human is a UX trap).
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        <span>
          Enable parallel race for this route plan
        </span>
      </label>

      {enabled && (
        <div>
          <p className="text-xs text-fg-subtle mb-2">
            Pick 2–4 carriers to race ({selected.length} selected).
          </p>
          <div className="grid grid-cols-2 gap-2">
            {carriers.map((c) => (
              <label
                key={c.id}
                className={
                  selected.length >= 4 && !selected.includes(c.id)
                    ? 'flex items-center gap-2 text-sm opacity-50 cursor-not-allowed'
                    : 'flex items-center gap-2 text-sm cursor-pointer'
                }
              >
                <input
                  type="checkbox"
                  checked={selected.includes(c.id)}
                  onChange={() => toggleCarrier(c.id)}
                  disabled={
                    selected.length >= 4 && !selected.includes(c.id)
                  }
                  className="h-4 w-4"
                />
                <span>{c.name}</span>
                <span className="font-mono text-xs text-fg-subtle">
                  {c.id}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={
            saving || (enabled && selected.length < 2)
          }
          className="bg-primary text-on-primary px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {enabled && selected.length < 2 && (
          <span className="text-warn text-xs">
            Pick at least 2 carriers, or disable the toggle.
          </span>
        )}
        {success && (
          <span className="text-success text-xs">Saved.</span>
        )}
        {error && <span className="text-error text-xs">{error}</span>}
      </div>

      <p className="text-xs text-fg-subtle">
        Each race counts as <strong>1 attempt</strong> toward
        frequency caps (TCPA-safer reading + matches typical
        carrier billing on 200 OK). The audit log tags every race
        with{' '}
        <span className="font-mono">pacing.parallel_race</span>{' '}
        including the racing carriers. Per-carrier win rate +
        PDD on{' '}
        <a
          href="/reports/carrier-race-stats"
          className="text-link hover:underline"
        >
          /reports/carrier-race-stats
        </a>
        .
      </p>
    </div>
  );
}
