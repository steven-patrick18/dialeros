import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listFlaggedCalls } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { ClearButton } from './clear-button';

export const dynamic = 'force-dynamic';

function fmtDuration(ms: number | null): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r.toString().padStart(2, '0')}s`;
}

export default async function FlaggedCallsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Flagged calls</h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }
  const rows = JSON.parse(JSON.stringify(listFlaggedCalls(200)));

  return (
    <div className="max-w-6xl">
      <div className="text-xs text-fg-subtle mb-1">
        <Link href="/reports" className="text-link hover:underline">
          ← back to reports
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">Flagged calls</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        Calls flagged for QA review by supervisors during live
        monitoring. Click the call ID to open the detail page
        (audio, transcript, AI summary, disposition timeline);
        click Clear when QA is done.
      </p>

      {(rows as ReturnType<typeof listFlaggedCalls>).length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No calls flagged for QA right now. Flag from the
          supervisor floor while monitoring.
        </p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-bg-elevated text-fg-subtle text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2">Flagged</th>
                <th className="px-3 py-2">Call</th>
                <th className="px-3 py-2">Campaign</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Lead</th>
                <th className="px-3 py-2">Disposition</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Reason</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(rows as ReturnType<typeof listFlaggedCalls>).map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border align-top"
                >
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <div>{new Date(r.flagged_at).toLocaleString()}</div>
                    {r.flagged_by_username ? (
                      <div className="text-fg-subtle">
                        by {r.flagged_by_username}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/calls/${r.id}`}
                      className="text-link hover:underline"
                    >
                      #{r.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.campaign_name ?? r.campaign_id}
                  </td>
                  <td className="px-3 py-2 text-xs font-mono">
                    {r.agent_username ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{r.lead_phone}</div>
                    {r.lead_name ? (
                      <div className="text-xs text-fg-subtle">
                        {r.lead_name}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.disposition ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs tabular-nums whitespace-nowrap">
                    {fmtDuration(r.duration_ms)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.flag_reason ? (
                      <span className="break-words">{r.flag_reason}</span>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <ClearButton intentId={r.id} />
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
