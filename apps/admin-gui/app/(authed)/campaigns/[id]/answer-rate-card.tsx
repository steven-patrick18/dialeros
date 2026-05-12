import {
  answerRateByHourWeekday,
  answerRateForCurrentBucket,
  recommendDialLevel,
} from '@dialeros/control-plane';

// Iter 132 — predictive-pacing card. Surfaces the historical
// answer rate for the current (hour, weekday) bucket alongside
// the campaign's overall 30-day rate, and recommends a
// dial_level matched to that bucket. Read-only for v1 — iter
// 133 wires a "Apply this dial_level" button + makes the
// recommendation curve operator-tunable.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AnswerRateCard({
  campaignId,
  currentDialLevel,
}: {
  campaignId: string;
  currentDialLevel: number;
}) {
  const now = new Date();
  const bucket = answerRateForCurrentBucket(campaignId, 30, now);
  const summary = answerRateByHourWeekday(campaignId, 30);

  const recommended =
    bucket && bucket.answer_rate >= 0
      ? recommendDialLevel(bucket.answer_rate)
      : null;
  const delta =
    recommended !== null ? recommended - currentDialLevel : 0;
  const advice =
    recommended === null
      ? 'Not enough history for this hour yet — using the conservative default.'
      : Math.abs(delta) < 0.05
        ? 'Your dial_level matches the recommendation.'
        : delta > 0
          ? `Consider raising dial_level by ${delta.toFixed(1)} — current answer rate is low and agents may be sitting idle.`
          : `Consider lowering dial_level by ${Math.abs(delta).toFixed(1)} — current answer rate is high and you risk abandons.`;

  const overallPct =
    summary.overall_rate >= 0
      ? `${(summary.overall_rate * 100).toFixed(1)}%`
      : '—';
  const bucketPct =
    bucket && bucket.answer_rate >= 0
      ? `${(bucket.answer_rate * 100).toFixed(1)}%`
      : '—';
  const bucketLabel = `${WEEKDAYS[now.getDay()]} ${String(now.getHours()).padStart(2, '0')}:00`;

  return (
    <div className="border border-border rounded p-4 mb-6 max-w-4xl">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          Pacing recommendation
        </h2>
        <span className="text-xs text-fg-subtle">
          last 30d · {summary.total_calls.toLocaleString()} calls
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div className="border border-border rounded p-2">
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
            Answer rate (now)
          </div>
          <div className="text-lg mt-0.5 tabular-nums text-fg">
            {bucketPct}
          </div>
          <div className="text-[10px] text-fg-subtle mt-0.5">
            {bucketLabel}
            {bucket && ` · ${bucket.total} calls`}
          </div>
        </div>
        <div className="border border-border rounded p-2">
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
            Answer rate (30d)
          </div>
          <div className="text-lg mt-0.5 tabular-nums text-fg">
            {overallPct}
          </div>
          <div className="text-[10px] text-fg-subtle mt-0.5">
            cross-bucket average
          </div>
        </div>
        <div className="border border-border rounded p-2">
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
            Current dial_level
          </div>
          <div className="text-lg mt-0.5 tabular-nums text-fg">
            {currentDialLevel.toFixed(1)}
          </div>
        </div>
        <div className="border border-border rounded p-2">
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
            Recommended
          </div>
          <div
            className={`text-lg mt-0.5 tabular-nums ${
              recommended === null
                ? 'text-fg-subtle'
                : Math.abs(delta) < 0.05
                  ? 'text-success'
                  : delta > 0
                    ? 'text-warn'
                    : 'text-info'
            }`}
          >
            {recommended === null ? '—' : recommended.toFixed(1)}
          </div>
        </div>
      </div>
      <p className="text-xs text-fg-muted">{advice}</p>
      <p className="text-[10px] text-fg-subtle mt-2">
        Iter 132 — recommendation curve: ≥50% → 1.0 · 25–50% → 1.5 ·
        15–25% → 2.0 · 5–15% → 3.0 · &lt;5% → 4.0. Iter 133 makes
        thresholds operator-tunable + adds &quot;Apply this dial_level&quot;.
      </p>
    </div>
  );
}
