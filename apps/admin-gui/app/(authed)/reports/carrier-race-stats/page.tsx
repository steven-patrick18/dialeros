import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getCarrier,
  getCarrierRaceStats,
  listRaceOutcomes,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Iter 183 — Per-carrier race telemetry. Shows win rate + PDD
// distribution for each carrier participating in parallel
// race-to-answer originate calls over the last 7 days.

function pctStr(num: number, denom: number): string {
  if (denom === 0) return '—';
  return `${((num / denom) * 100).toFixed(1)}%`;
}

function pddStr(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export default async function CarrierRaceStatsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Carrier race stats</h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }
  const stats = JSON.parse(
    JSON.stringify(getCarrierRaceStats(7)),
  ) as ReturnType<typeof getCarrierRaceStats>;
  const recent = JSON.parse(
    JSON.stringify(listRaceOutcomes(50)),
  ) as ReturnType<typeof listRaceOutcomes>;
  const totalRaces = stats.reduce(
    (a, s) => Math.max(a, s.races_in),
    0,
  );

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-1">Carrier race stats</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Per-carrier win rate + PDD over the last 7 days, across all
        parallel race-to-answer originates. Operator uses this to
        prune slow carriers from a race once a clear lead emerges
        (typically after ~1000 races per plan). Configure races on
        each{' '}
        <Link
          href="/route-plans"
          className="text-link hover:underline"
        >
          /route-plans
        </Link>
        &nbsp;detail page.
      </p>

      {stats.length === 0 ? (
        <p className="text-sm text-fg-subtle">
          No races recorded yet. Enable parallel race-to-answer on
          a route plan + run a voicemail-drop campaign through it
          to populate this table.
        </p>
      ) : (
        <table className="w-full text-sm border border-border rounded mb-8">
          <thead className="bg-card">
            <tr className="text-left">
              <th className="px-3 py-2">Carrier</th>
              <th className="px-3 py-2">Raced in</th>
              <th className="px-3 py-2">Won</th>
              <th className="px-3 py-2">Win rate</th>
              <th className="px-3 py-2">PDD min / avg / max</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => {
              const c = getCarrier(s.carrier_id);
              return (
                <tr
                  key={s.carrier_id}
                  className="border-t border-border"
                >
                  <td className="px-3 py-2">
                    {c?.name ?? s.carrier_id}{' '}
                    <span className="font-mono text-xs text-fg-subtle">
                      {s.carrier_id}
                    </span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{s.races_in}</td>
                  <td className="px-3 py-2 tabular-nums">{s.races_won}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {pctStr(s.races_won, s.races_in)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-xs">
                    {pddStr(s.min_pdd_ms)} /{' '}
                    {pddStr(s.avg_pdd_ms ? Math.round(s.avg_pdd_ms) : null)} /{' '}
                    {pddStr(s.max_pdd_ms)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2 className="text-sm font-semibold mb-2">
        Recent races ({recent.length} of last 50)
      </h2>
      <table className="w-full text-xs border border-border rounded">
        <thead className="bg-card">
          <tr className="text-left">
            <th className="px-3 py-2">Started</th>
            <th className="px-3 py-2">Carriers raced</th>
            <th className="px-3 py-2">Winner</th>
            <th className="px-3 py-2">PDD</th>
          </tr>
        </thead>
        <tbody>
          {recent.map((r) => {
            let carriers: string[] = [];
            try {
              carriers = JSON.parse(r.raced_carriers_json) as string[];
            } catch {
              /* skip */
            }
            return (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono">
                  {new Date(r.started_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 font-mono">
                  {carriers.join(' vs ')}
                </td>
                <td className="px-3 py-2 font-mono">
                  {r.winner_carrier_id ?? (
                    <span className="text-fg-muted">— pending —</span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {pddStr(r.winner_pdd_ms)}
                </td>
              </tr>
            );
          })}
          {recent.length === 0 && (
            <tr>
              <td
                colSpan={4}
                className="px-3 py-6 text-center text-fg-muted"
              >
                No races yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="text-xs text-fg-subtle mt-4">
        Winner detection currently lands when CHANNEL_ANSWER fires
        on a parallel originate; the &lsquo;— pending —&rsquo;
        rows are races whose loser legs hit some failure or whose
        FS event hasn&apos;t propagated yet. Counts as 1 attempt
        toward TCPA frequency caps regardless of leg count.
      </p>
    </div>
  );
}
