import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listAgentProductivity } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Iter 173 — Per-agent productivity table. Admin + supervisor.
// Default window = 7 days; ?days=N (1-90) overrides. Skips
// agents with zero calls in the window. Sorted by attempts DESC.

const DEFAULT_DAYS = 7;

function fmtDuration(ms: number): string {
  if (ms <= 0) return '—';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm.toString().padStart(2, '0')}m`;
}

export default async function AgentsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">
          Agent productivity
        </h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }

  const { days: rawDays } = await searchParams;
  const days = Math.max(
    1,
    Math.min(90, Number(rawDays) || DEFAULT_DAYS),
  );
  const sinceIso = new Date(
    Date.now() - days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const untilIso = new Date().toISOString();
  const rows = JSON.parse(
    JSON.stringify(listAgentProductivity(sinceIso, untilIso)),
  );

  // Floor totals (denominators for per-capita and rate metrics).
  type Row = ReturnType<typeof listAgentProductivity>[number];
  const totals = (rows as Row[]).reduce(
    (
      acc: {
        attempts: number;
        answered: number;
        agent_dispo: number;
        talk_ms: number;
      },
      r: Row,
    ) => ({
      attempts: acc.attempts + r.calls_attempted,
      answered: acc.answered + r.calls_answered,
      agent_dispo: acc.agent_dispo + r.agent_dispositioned,
      talk_ms: acc.talk_ms + r.talk_time_ms,
    }),
    { attempts: 0, answered: 0, agent_dispo: 0, talk_ms: 0 },
  );
  const windowHours = (days * 24) || 1;

  return (
    <div className="max-w-6xl">
      <div className="text-xs text-fg-subtle mb-1">
        <Link href="/reports" className="text-link hover:underline">
          ← back to reports
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">
        Agent productivity — last {days} days
      </h1>
      <p className="text-fg-subtle text-sm mb-4 max-w-3xl">
        Per-agent stats across all campaigns. talk = sum of
        duration_ms on answered calls. wrap = dispositioned_at -
        hangup_at on agent-tagged rows (iter-146 auto rows
        excluded from the wrap-time average since they're tagged
        without an agent's action). Window override:{' '}
        <code className="text-xs">?days=N</code> (1-90).
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 max-w-4xl">
        <StatCard
          label="Active agents"
          value={(rows as Row[]).length.toLocaleString()}
        />
        <StatCard
          label="Attempts"
          value={totals.attempts.toLocaleString()}
        />
        <StatCard
          label="Answered"
          value={totals.answered.toLocaleString()}
        />
        <StatCard
          label="Talk time"
          value={fmtDuration(totals.talk_ms)}
        />
      </div>

      {(rows as Row[]).length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No agent activity in this window.
        </p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated text-fg-subtle text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2 text-right">Attempts</th>
                <th className="px-3 py-2 text-right">Answered</th>
                <th className="px-3 py-2 text-right">Talk total</th>
                <th className="px-3 py-2 text-right">Avg talk</th>
                <th className="px-3 py-2 text-right">Agent dispo</th>
                <th className="px-3 py-2 text-right">Avg wrap</th>
                <th className="px-3 py-2 text-right">Dispo / hr</th>
              </tr>
            </thead>
            <tbody>
              {(rows as Row[]).map((r: Row) => (
                <tr
                  key={r.user_id}
                  className="border-t border-border align-top"
                >
                  <td className="px-3 py-2">
                    <Link
                      href={`/users/${r.user_id}`}
                      className="text-link hover:underline"
                    >
                      {r.display_name || r.username}
                    </Link>
                    {r.display_name ? (
                      <div className="text-xs text-fg-subtle">
                        {r.username}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.calls_attempted.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.calls_answered.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {fmtDuration(r.talk_time_ms)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {fmtDuration(r.avg_talk_ms)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.agent_dispositioned.toLocaleString()}
                    {r.auto_dispositioned > 0 ? (
                      <span className="text-fg-subtle text-xs">
                        {' '}
                        (+{r.auto_dispositioned} auto)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                    {fmtDuration(r.avg_wrap_ms)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {windowHours > 0
                      ? (r.agent_dispositioned / windowHours).toFixed(2)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border rounded p-3 bg-card">
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}
