import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getActiveAgentsForCampaign,
  getCampaign,
  getCampaignAllowedUserIds,
  getCampaignLeadLists,
  getLeadList,
  getRoutePlan,
  getUser,
  isCampaignWithinCallWindow,
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
  const activeAgents = getActiveAgentsForCampaign(id);
  const insideWindow = isCampaignWithinCallWindow(c);

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
          ACTIVE starts the pacer (one dial intent every ~3s, round-robin
          across active attached agents). PAUSED / ARCHIVED stops it.
        </p>
        {c.status === 'active' && activeAgents.length === 0 && (
          <p className="bg-warn/10 text-warn border border-warn/50 rounded mt-3 px-3 py-2 text-xs">
            No active agents attached — pacer is running but cannot dial.
            Attach an active agent below to start delivering calls.
          </p>
        )}
        {c.status === 'active' && !insideWindow && (
          <p className="bg-warn/10 text-warn border border-warn/50 rounded mt-3 px-3 py-2 text-xs">
            Outside the configured call window
            {c.call_window_start && c.call_window_end && (
              <>
                {' '}
                ({c.call_window_start}–{c.call_window_end})
              </>
            )}{' '}
            — pacer is ticking but skipping every dial. Calls resume
            automatically when the window opens.
          </p>
        )}
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

      <AllowedUsersCard
        campaignId={c.id}
        activeAgentCount={activeAgents.length}
      />

      <dl className="grid grid-cols-2 gap-3 text-xs max-w-4xl">
        <Detail label="ID" value={<span className="font-mono">{c.id}</span>} />
        <Detail
          label="Created"
          value={new Date(c.created_at).toLocaleString()}
        />
      </dl>

      <div className="mt-8 max-w-4xl flex items-center gap-4">
        <Link
          href={`/campaigns/${c.id}/edit`}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm"
        >
          Edit campaign
        </Link>
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

function AllowedUsersCard({
  campaignId,
  activeAgentCount,
}: {
  campaignId: string;
  activeAgentCount: number;
}) {
  const userIds = getCampaignAllowedUserIds(campaignId);
  const users = userIds.map((id) => getUser(id)).filter(Boolean);
  return (
    <div className="border border-border rounded p-4 mb-6 max-w-4xl">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
        Attached users ({users.length}){' '}
        <span className="text-fg-subtle normal-case tracking-normal ml-1">
          — {activeAgentCount} active agent
          {activeAgentCount === 1 ? '' : 's'} eligible to receive calls
        </span>
      </h2>
      {users.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No users attached. Edit a user&apos;s detail page to attach them to
          this campaign.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {users.map((u) =>
            u ? (
              <li key={u.id} className="flex items-center gap-3">
                <Link
                  href={`/users/${u.id}`}
                  className="hover:underline"
                >
                  {u.username}
                </Link>
                <span className="text-fg-subtle text-xs uppercase">
                  {u.role}
                </span>
                {u.is_active === 0 && (
                  <span className="bg-error/10 text-error border border-error/50 px-2 py-0.5 rounded text-xs">
                    INACTIVE
                  </span>
                )}
              </li>
            ) : null,
          )}
        </ul>
      )}
    </div>
  );
}
