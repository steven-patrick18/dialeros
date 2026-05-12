import {
  answerRateByHourWeekday,
  answerRateForCurrentBucket,
  recommendDialLevel,
} from '@dialeros/control-plane';
import { ApplyRecommendationButton } from './apply-recommendation-button';

// Iter 132 (data) + iter 133 (apply button + 24x7 heatmap).
// Server-rendered card on the Real-Time tab. Shows:
//   1. Current bucket vs 30d overall + current vs recommended
//      dial_level with an apply-recommendation button.
//   2. 24×7 heatmap of answer rate by (weekday, hour). Cells
//      are tone-coded by rate, sparse buckets stay neutral.
//      Today's "now" cell highlighted with a yellow border so
//      operators read it at a glance.

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

  // Iter 133 — heatmap grid. Pre-bucketize the sparse rows into
  // a dense 7×24 array so the grid renders even when most slots
  // are empty.
  type Cell = { total: number; answered: number; rate: number };
  const grid: (Cell | null)[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => null),
  );
  for (const b of summary.buckets) {
    grid[b.weekday]![b.hour] = {
      total: b.total,
      answered: b.answered,
      rate: b.answer_rate,
    };
  }
  const todayWeekday = now.getDay();
  const nowHour = now.getHours();

  return (
    <div className="border border-border rounded p-4 mb-6 max-w-6xl">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted">
          Pacing recommendation
        </h2>
        <span className="text-xs text-fg-subtle">
          last 30d · {summary.total_calls.toLocaleString()} calls
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3 max-w-4xl">
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

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <p className="text-xs text-fg-muted">{advice}</p>
        <ApplyRecommendationButton
          campaignId={campaignId}
          currentDialLevel={currentDialLevel}
          recommendedDialLevel={recommended}
        />
      </div>

      {/* Iter 133 — 24×7 heatmap. Renders when ANY bucket has
          data; otherwise hidden to keep the card compact on
          new campaigns. */}
      {summary.total_calls > 0 && (
        <div className="overflow-x-auto">
          <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1.5">
            Answer rate by (weekday × hour)
          </div>
          <table className="text-[10px] border-separate border-spacing-0.5 tabular-nums">
            <thead>
              <tr>
                <th className="w-9" />
                {Array.from({ length: 24 }, (_, h) => (
                  <th
                    key={h}
                    className={`w-7 px-0 py-0 text-fg-subtle font-normal ${
                      h === nowHour ? 'text-accent' : ''
                    }`}
                  >
                    {h % 3 === 0 ? h : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAYS.map((dayLabel, wd) => (
                <tr key={wd}>
                  <td
                    className={`pr-1 text-right text-fg-subtle ${
                      wd === todayWeekday ? 'text-accent font-medium' : ''
                    }`}
                  >
                    {dayLabel}
                  </td>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = grid[wd]![h];
                    const isNow = wd === todayWeekday && h === nowHour;
                    return (
                      <td
                        key={h}
                        className="w-7 h-6 p-0"
                        title={
                          cell
                            ? `${dayLabel} ${String(h).padStart(2, '0')}:00 — ${(cell.rate * 100).toFixed(1)}% (${cell.answered}/${cell.total})`
                            : `${dayLabel} ${String(h).padStart(2, '0')}:00 — no data`
                        }
                      >
                        <div
                          className={`h-6 rounded-sm ${heatClass(cell?.rate ?? null)} ${
                            isNow
                              ? 'ring-1 ring-accent ring-inset'
                              : ''
                          }`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2 mt-2 text-[10px] text-fg-subtle">
            <span>0%</span>
            <span className={`w-4 h-3 rounded-sm ${heatClass(0)}`} />
            <span className={`w-4 h-3 rounded-sm ${heatClass(0.05)}`} />
            <span className={`w-4 h-3 rounded-sm ${heatClass(0.15)}`} />
            <span className={`w-4 h-3 rounded-sm ${heatClass(0.3)}`} />
            <span className={`w-4 h-3 rounded-sm ${heatClass(0.5)}`} />
            <span className={`w-4 h-3 rounded-sm ${heatClass(0.7)}`} />
            <span>70%+</span>
            <span className="mx-2 text-fg-subtle/70">·</span>
            <span className="w-4 h-3 rounded-sm border border-border bg-card-hover/30" />
            <span>no data</span>
            <span className="mx-2 text-fg-subtle/70">·</span>
            <span className="w-4 h-3 rounded-sm border border-accent ring-1 ring-accent ring-inset" />
            <span>now</span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-fg-subtle mt-2">
        Iter 132 / 133 — recommendation curve: ≥50% → 1.0 · 25–50%
        → 1.5 · 15–25% → 2.0 · 5–15% → 3.0 · &lt;5% → 4.0.
        Threshold curve becomes operator-tunable in iter 134.
      </p>
    </div>
  );
}

// Heatmap cell tone. Reuses Tailwind utility classes already
// loaded by other cards so no extra CSS. Color saturates as the
// answer rate climbs.
function heatClass(rate: number | null): string {
  if (rate === null || rate < 0) {
    return 'bg-card-hover/30 border border-border';
  }
  if (rate < 0.05) return 'bg-error/60';
  if (rate < 0.15) return 'bg-error/30';
  if (rate < 0.25) return 'bg-warn/40';
  if (rate < 0.4) return 'bg-warn/60';
  if (rate < 0.5) return 'bg-success/40';
  if (rate < 0.7) return 'bg-success/60';
  return 'bg-success';
}
