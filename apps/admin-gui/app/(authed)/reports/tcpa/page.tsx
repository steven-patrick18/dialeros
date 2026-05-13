import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getDailyDialMetrics,
  getPerCampaignTcpaMetrics,
  getRollingTcpaMetrics,
  getTcpaAuditActivity,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { PrintButton } from './print-button';

export const dynamic = 'force-dynamic';

// Iter 165 — TCPA compliance report. Audit-grade rolling 30-day
// window matching the FCC formula. Print-friendly via the
// @media print CSS in globals; operators print or save-as-PDF.
//
// Window logic: ?days=N query param overrides the 30-day default.
// Regulators occasionally ask for 7-day or 90-day rollups; the
// math is identical, just a different sinceIso.

const FCC_ABANDON_CAP_PCT = 3.0;
const DEFAULT_WINDOW_DAYS = 30;

export default async function TcpaReportPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">TCPA report</h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }

  const { days: rawDays } = await searchParams;
  const days = Math.max(
    1,
    Math.min(365, Number(rawDays) || DEFAULT_WINDOW_DAYS),
  );
  const sinceIso = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const untilIso = new Date().toISOString();

  const metrics = getRollingTcpaMetrics(sinceIso, untilIso);
  const daily = getDailyDialMetrics(sinceIso, untilIso);
  const byCampaign = getPerCampaignTcpaMetrics(sinceIso, untilIso);
  const dnc = getTcpaAuditActivity(sinceIso);

  const overCap = metrics.abandon_rate_pct > FCC_ABANDON_CAP_PCT;
  const maxDaily =
    daily.reduce((m, d) => Math.max(m, d.attempts), 1) || 1;

  return (
    <div className="max-w-5xl">
      <div className="text-xs text-fg-subtle mb-1 no-print">
        <Link href="/reports" className="text-link hover:underline">
          ← back to reports
        </Link>
      </div>
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-2xl font-semibold">
          TCPA compliance — last {days} days
        </h1>
        <PrintButton />
      </div>
      <p className="text-fg-subtle text-sm mb-6">
        Window: {new Date(sinceIso).toLocaleString()} →{' '}
        {new Date(untilIso).toLocaleString()}. FCC cap on abandon
        rate:{' '}
        <span className="font-mono">{FCC_ABANDON_CAP_PCT.toFixed(1)}%</span>{' '}
        of answered-live calls. Adjust the window with{' '}
        <code className="text-xs">?days=N</code> (1-365). Simulated
        calls excluded.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 max-w-4xl">
        <StatCard
          label="Dial attempts"
          value={metrics.attempts.toLocaleString()}
        />
        <StatCard
          label="Answered live"
          value={metrics.answered_live.toLocaleString()}
        />
        <StatCard
          label="Abandoned"
          value={metrics.abandoned.toLocaleString()}
          tone={metrics.abandoned > 0 ? 'warn' : 'muted'}
        />
        <StatCard
          label="Abandon rate"
          value={`${metrics.abandon_rate_pct.toFixed(2)}%`}
          tone={overCap ? 'error' : metrics.abandon_rate_pct > FCC_ABANDON_CAP_PCT * 0.8 ? 'warn' : 'success'}
          hint={`cap ${FCC_ABANDON_CAP_PCT.toFixed(1)}%`}
        />
      </div>

      {overCap ? (
        <div className="border border-error/50 bg-error/10 text-error rounded p-3 text-sm mb-6">
          ⚠ Floor-wide abandon rate over the FCC 3% cap. Review the
          per-campaign breakdown below — over-cap campaigns are
          flagged. Iter-147&apos;s real-time guardrail clamps
          target=0 on offending campaigns at the next tick; this
          report shows the trailing window for auditors.
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6 max-w-4xl">
        <StatCard
          label="Answering machine"
          value={metrics.answering_machine.toLocaleString()}
          tone="muted"
        />
        <StatCard
          label="No answer"
          value={metrics.no_answer.toLocaleString()}
          tone="muted"
        />
        <StatCard
          label="Busy"
          value={metrics.busy.toLocaleString()}
          tone="muted"
        />
        <StatCard
          label="Carrier reject"
          value={metrics.carrier_rejected.toLocaleString()}
          tone={metrics.carrier_rejected > 0 ? 'warn' : 'muted'}
        />
        <StatCard
          label="Originate errors"
          value={metrics.originate_errors.toLocaleString()}
          tone={metrics.originate_errors > 0 ? 'warn' : 'muted'}
        />
      </div>

      <section className="mb-8">
        <h2 className="text-base font-semibold mb-2">
          Per-campaign breakdown
        </h2>
        {byCampaign.length === 0 ? (
          <p className="text-fg-subtle text-sm">
            No campaign activity in this window.
          </p>
        ) : (
          <table className="w-full text-sm border border-border rounded">
            <thead className="bg-bg-elevated text-fg-subtle text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2 text-right">Attempts</th>
                <th className="px-3 py-2 text-right">Answered</th>
                <th className="px-3 py-2 text-right">Abandoned</th>
                <th className="px-3 py-2 text-right">Rate</th>
                <th className="px-3 py-2 text-right">Cap</th>
              </tr>
            </thead>
            <tbody>
              {byCampaign.map((c) => (
                <tr
                  key={c.campaign_id}
                  className={`border-t border-border ${c.over_cap ? 'bg-error/5' : ''}`}
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/campaigns/${c.campaign_id}`}
                      className="text-link hover:underline"
                    >
                      {c.campaign_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.attempts.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.answered_live.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {c.abandoned.toLocaleString()}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-semibold ${c.over_cap ? 'text-error' : ''}`}
                  >
                    {c.abandon_rate_pct.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-subtle">
                    {c.max_abandon_pct.toFixed(1)}%
                    {c.over_cap ? ' ⚠' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold mb-2">
          Daily volume
        </h2>
        {daily.length === 0 ? (
          <p className="text-fg-subtle text-sm">No activity.</p>
        ) : (
          <div className="space-y-1 text-xs">
            {daily.map((d) => (
              <div key={d.date} className="flex items-center gap-3">
                <span className="text-fg-subtle font-mono w-24">
                  {d.date}
                </span>
                <div className="flex-1 bg-card-hover/30 rounded h-4 relative">
                  <div
                    className="bg-accent rounded h-4"
                    style={{ width: `${(d.attempts / maxDaily) * 100}%` }}
                  />
                </div>
                <span className="tabular-nums text-fg w-16 text-right">
                  {d.attempts.toLocaleString()}
                </span>
                <span className="tabular-nums text-fg-subtle w-14 text-right">
                  {d.abandon_rate_pct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="text-base font-semibold mb-2">
          DNC + throttle activity
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 max-w-4xl">
          <StatCard
            label="DNC adds (manual)"
            value={dnc.dnc_added.toLocaleString()}
          />
          <StatCard
            label="DNC bulk adds"
            value={dnc.dnc_bulk_added.toLocaleString()}
          />
          <StatCard
            label="DNC removed"
            value={dnc.dnc_removed.toLocaleString()}
            tone={dnc.dnc_removed > 0 ? 'warn' : 'muted'}
          />
          <StatCard
            label="Throttle events"
            value={dnc.throttle_events.toLocaleString()}
            tone={dnc.throttle_events > 0 ? 'warn' : 'success'}
          />
          <StatCard
            label="Throttle cleared"
            value={dnc.throttle_cleared_events.toLocaleString()}
            tone="muted"
          />
        </div>
        <p className="text-xs text-fg-subtle mt-2">
          Throttle events are from iter-164: every time the pacer
          clamped a campaign target=0 because the rolling
          last-100-call abandon rate exceeded its configured cap.
          Pair with /audit for the per-event payload.
        </p>
      </section>

      <p className="text-xs text-fg-subtle border-t border-border pt-3">
        Report generated {new Date().toLocaleString()}. Methodology:
        abandoned-rate = abandoned / (answered_live + abandoned).
        Answered_live = answered_at non-null AND disposition not in
        the iter-146 auto-codes (A/NA/B/CC/OE/AM/AM-VMD/AM-DROP)
        OR answered with no disposition yet (agent walked away).
      </p>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'fg',
  hint,
}: {
  label: string;
  value: string;
  tone?: 'fg' | 'success' | 'warn' | 'error' | 'muted';
  hint?: string;
}) {
  const cls = {
    fg: 'text-fg',
    success: 'text-success',
    warn: 'text-warn',
    error: 'text-error',
    muted: 'text-fg-muted',
  }[tone];
  return (
    <div className="border border-border rounded p-3 bg-card">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={`text-2xl font-semibold tabular-nums ${cls}`}>
        {value}
      </div>
      {hint ? (
        <div className="text-[10px] text-fg-subtle">{hint}</div>
      ) : null}
    </div>
  );
}
