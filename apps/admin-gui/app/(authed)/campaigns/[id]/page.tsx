import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getCampaign,
  getCampaignLeadLists,
  getLeadList,
  getRoutePlan,
  leadCountFor,
  totalIntentsFor,
} from '@dialeros/control-plane';
import { StatusToggle } from './status-toggle';
import { DeleteCampaignButton } from './delete-button';
import { PacingPanel } from './pacing-panel';

export const dynamic = 'force-dynamic';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-success/15 text-success border-success/50',
  paused: 'bg-warn/15 text-warn border-warn/50',
  archived: 'bg-card-hover/40 text-fg-muted border-border',
};

export default async function CampaignDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const c = getCampaign(id);
  if (!c) notFound();

  const routePlan = getRoutePlan(c.route_plan_id);
  const leadListIds = getCampaignLeadLists(id);
  const leadLists = leadListIds.map((lid) => getLeadList(lid)).filter(Boolean);
  const totalLeads = leadLists.reduce(
    (acc, l) => acc + (l ? leadCountFor(l.id) : 0),
    0,
  );

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/campaigns"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          ← Campaigns
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">{c.name}</h1>
        <span
          className={`${STATUS_STYLES[c.status] ?? STATUS_STYLES.archived} border px-2 py-0.5 rounded text-xs uppercase`}
        >
          {c.status}
        </span>
      </div>
      <p className="text-fg-subtle text-sm font-mono mb-1">{c.type}</p>
      {c.description && (
        <p className="text-fg-muted text-sm mb-6">{c.description}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mb-6">
        <Card title="Route plan">
          {routePlan ? (
            <Link
              href={`/route-plans/${routePlan.id}`}
              className="text-sm hover:underline"
            >
              {routePlan.name}
            </Link>
          ) : (
            <p className="text-error text-sm">missing</p>
          )}
        </Card>

        <Card title={`Lead lists (${leadLists.length} attached)`}>
          {leadLists.length === 0 ? (
            <p className="text-fg-subtle text-sm">none</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {leadLists.map((l) =>
                l ? (
                  <li
                    key={l.id}
                    className="flex justify-between items-center"
                  >
                    <Link
                      href={`/leads/${l.id}`}
                      className="hover:underline"
                    >
                      {l.name}
                    </Link>
                    <span className="text-fg-subtle text-xs tabular-nums">
                      {leadCountFor(l.id).toLocaleString()} leads
                    </span>
                  </li>
                ) : null,
              )}
              <li className="pt-2 mt-2 border-t border-border flex justify-between text-xs">
                <span className="text-fg-subtle">Total dialable</span>
                <span className="tabular-nums text-fg">
                  {totalLeads.toLocaleString()}
                </span>
              </li>
            </ul>
          )}
        </Card>

        <Card title="Pacing">
          <Detail
            label="Base ratio"
            value={
              <span className="tabular-nums">{c.base_ratio.toFixed(1)}</span>
            }
          />
          <Detail
            label="Max abandon %"
            value={
              <span className="tabular-nums">
                {c.max_abandon_pct.toFixed(1)}
              </span>
            }
          />
          <p className="text-xs text-fg-subtle mt-2">
            Pacing engine + dial loop arrives in iter 10. For now this is just
            stored configuration.
          </p>
        </Card>

        <Card title="Compliance">
          {c.call_window_start && c.call_window_end ? (
            <Detail
              label="Call window"
              value={
                <span className="font-mono text-xs">
                  {c.call_window_start} – {c.call_window_end} caller-local
                </span>
              }
            />
          ) : (
            <p className="text-fg-subtle text-sm">No window restriction.</p>
          )}
        </Card>
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Status
        </h2>
        <StatusToggle id={c.id} current={c.status} />
        <p className="text-xs text-fg-subtle mt-3">
          ACTIVE starts the simulated pacer (one dial intent every ~3s).
          PAUSED / ARCHIVED stops it.
        </p>
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Dial intents (live)
        </h2>
        <PacingPanel
          campaignId={c.id}
          isActive={c.status === 'active'}
          initialTotal={totalIntentsFor(c.id)}
        />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs max-w-4xl">
        <Detail label="ID" value={<span className="font-mono">{c.id}</span>} />
        <Detail
          label="Created"
          value={new Date(c.created_at).toLocaleString()}
        />
      </dl>

      <div className="mt-8 max-w-4xl">
        <DeleteCampaignButton
          id={c.id}
          name={c.name}
          isActive={c.status === 'active'}
        />
      </div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded p-4 space-y-2">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        {title}
      </h2>
      {children}
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-fg text-right">{value}</dd>
    </div>
  );
}
