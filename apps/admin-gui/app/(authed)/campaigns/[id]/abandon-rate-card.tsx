'use client';

import { useEffect, useState } from 'react';

// Iter 147 — Live abandon-rate card. Polls
// /api/campaigns/[id]/abandon-rate every 10s. Shows:
//   - current rolling rate (last 100 dispositioned calls)
//   - campaign cap (max_abandon_pct)
//   - sample size + "insufficient sample" note when n < 50
//   - throttled banner when the pacer is skipping ticks
// Coloring is conservative: amber within 80% of the cap, red
// when at/over the cap and the sample is sufficient.

interface AbandonRate {
  campaign_id: string;
  max_abandon_pct: number;
  abandoned: number;
  total: number;
  rate_pct: number;
  sample_size: number;
  min_sample: number;
  throttled: boolean;
}

const POLL_INTERVAL_MS = 10_000;

export function AbandonRateCard({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<AbandonRate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchOnce() {
      try {
        const res = await fetch(
          `/api/campaigns/${campaignId}/abandon-rate`,
          { credentials: 'same-origin' },
        );
        if (!res.ok) {
          if (!cancelled) setError(`API ${res.status}`);
          return;
        }
        const json = (await res.json()) as AbandonRate;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }

    void fetchOnce();
    const handle = window.setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [campaignId]);

  if (error) {
    return (
      <div className="border border-border rounded p-4 bg-card">
        <h2 className="text-xs uppercase tracking-wide text-fg-subtle mb-2">
          Abandon rate
        </h2>
        <p className="text-error text-sm">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="border border-border rounded p-4 bg-card">
        <h2 className="text-xs uppercase tracking-wide text-fg-subtle mb-2">
          Abandon rate
        </h2>
        <p className="text-fg-subtle text-sm">Loading…</p>
      </div>
    );
  }

  const cap = data.max_abandon_pct;
  const insufficient = data.total < data.min_sample;
  const rateClass = insufficient
    ? 'text-fg-muted'
    : data.throttled
      ? 'text-error'
      : data.rate_pct >= cap * 0.8
        ? 'text-warn'
        : 'text-success';

  return (
    <div className="border border-border rounded p-4 bg-card space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs uppercase tracking-wide text-fg-subtle">
          Abandon rate
        </h2>
        <span className="text-xs text-fg-subtle font-mono">
          n={data.total} / cap {cap.toFixed(1)}%
        </span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className={`text-3xl font-semibold ${rateClass}`}>
          {data.rate_pct.toFixed(2)}%
        </span>
        <span className="text-sm text-fg-subtle">
          {data.abandoned} / {data.total} answered calls
        </span>
      </div>
      {insufficient ? (
        <p className="text-xs text-fg-subtle">
          Insufficient sample (n={data.total} &lt; {data.min_sample}).
          The pacer waits for {data.min_sample} dispositioned calls
          before evaluating — protects new campaigns from being
          throttled on the first few unlucky outcomes.
        </p>
      ) : data.throttled ? (
        <p className="text-xs text-error">
          THROTTLED — pacer is skipping dial ticks. In-flight calls
          will finish; the rate re-evaluates as they dispose.
          Lower dial_level or pause the campaign if this persists.
        </p>
      ) : data.rate_pct >= cap * 0.8 ? (
        <p className="text-xs text-warn">
          Approaching cap. Consider reducing dial_level if pool size
          shrinks before the rate eases.
        </p>
      ) : (
        <p className="text-xs text-fg-subtle">Within cap.</p>
      )}
    </div>
  );
}
