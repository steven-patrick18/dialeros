'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Iter 133 — one-click "Apply recommended dial_level" control.
// PATCHes the campaign through the existing /api/campaigns/[id]
// endpoint that InlineCardForm uses for the pacing knobs, so we
// pick up its audit + validation path for free.
//
// Disabled when the recommended value already matches the current
// (within 0.05) — no point in a no-op write that still bumps
// updated_at + writes an audit row.

export function ApplyRecommendationButton({
  campaignId,
  currentDialLevel,
  recommendedDialLevel,
}: {
  campaignId: string;
  currentDialLevel: number;
  recommendedDialLevel: number | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (recommendedDialLevel === null) return null;
  const delta = recommendedDialLevel - currentDialLevel;
  const noop = Math.abs(delta) < 0.05;

  async function apply() {
    if (busy || noop) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dial_level: recommendedDialLevel }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || (j.ok !== undefined && !j.ok)) {
        setError(j.error ?? `apply failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'apply failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={apply}
        disabled={busy || noop}
        className={`text-xs px-3 py-1 rounded border disabled:opacity-40 ${
          noop
            ? 'border-success/40 text-success/70 cursor-default'
            : delta > 0
              ? 'border-warn/50 text-warn hover:bg-warn/10'
              : 'border-info/50 text-info hover:bg-info/10'
        }`}
        title={
          noop
            ? 'Current dial_level already matches the recommendation'
            : delta > 0
              ? `Raise dial_level to ${recommendedDialLevel.toFixed(1)}`
              : `Lower dial_level to ${recommendedDialLevel.toFixed(1)}`
        }
      >
        {busy
          ? 'Applying…'
          : noop
            ? 'Matches recommendation'
            : `Apply ${recommendedDialLevel.toFixed(1)}`}
      </button>
      {error && <span className="text-error text-xs">{error}</span>}
    </div>
  );
}
