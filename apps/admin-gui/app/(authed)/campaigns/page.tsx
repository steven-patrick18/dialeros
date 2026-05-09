import Link from 'next/link';
import {
  getCampaignLeadLists,
  getRoutePlan,
  listCampaigns,
  listLeadLists,
  listRoutePlans,
} from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-success/15 text-success border-success/50',
  paused: 'bg-warn/15 text-warn border-warn/50',
  archived: 'bg-card-hover/40 text-fg-muted border-border',
};

export default async function CampaignsPage() {
  const campaigns = listCampaigns();
  const routePlans = listRoutePlans();
  const leadLists = listLeadLists();
  const planName = new Map(routePlans.map((p) => [p.id, p.name]));
  const listName = new Map(leadLists.map((l) => [l.id, l.name]));

  const canCreate = routePlans.length > 0 && leadLists.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Campaigns</h1>
        {canCreate && (
          <Link
            href="/campaigns/add"
            className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm"
          >
            + New Campaign
          </Link>
        )}
      </div>

      <p className="text-fg-subtle text-sm mb-6 max-w-2xl">
        A campaign ties a route plan + lead lists together with pacing and
        compliance settings. Activating a campaign signals the pacing engine
        (Phase 2 continued) to start dialing.
      </p>

      {!canCreate ? (
        <div className="border border-warn/40 bg-warn/10 rounded p-4 text-sm max-w-2xl space-y-1">
          <p className="text-warn font-medium">Prerequisites missing.</p>
          {routePlans.length === 0 && (
            <p className="text-fg-muted">
              You need at least one route plan —{' '}
              <Link href="/route-plans" className="underline">
                add one
              </Link>
              .
            </p>
          )}
          {leadLists.length === 0 && (
            <p className="text-fg-muted">
              You need at least one lead list —{' '}
              <Link href="/leads" className="underline">
                add one
              </Link>
              .
            </p>
          )}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="border border-dashed border-border rounded p-8 text-center max-w-2xl">
          <p className="text-fg-muted">No campaigns yet.</p>
          <p className="text-fg-subtle text-sm mt-2">
            Click <span className="font-mono text-fg-muted">+ New Campaign</span>
            {' '}to create one.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-fg-subtle border-b border-border">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="font-medium">Type</th>
              <th className="font-medium">Route plan</th>
              <th className="font-medium">Lists</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const ids = getCampaignLeadLists(c.id);
              return (
                <tr key={c.id} className="border-b border-border/50">
                  <td className="py-3">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                  </td>
                  <td className="text-fg-muted text-xs font-mono">{c.type}</td>
                  <td className="text-fg-muted">
                    {planName.get(c.route_plan_id) ?? (
                      <span className="text-error">missing</span>
                    )}
                  </td>
                  <td className="text-fg-muted text-xs">
                    {ids.length === 0
                      ? '—'
                      : ids
                          .map((lid) => listName.get(lid) ?? '?')
                          .join(', ')}
                  </td>
                  <td>
                    <span
                      className={`${STATUS_STYLES[c.status] ?? STATUS_STYLES.archived} border px-2 py-0.5 rounded text-xs uppercase`}
                    >
                      {c.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
