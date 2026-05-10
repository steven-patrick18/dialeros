import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getInGroup,
  getInGroupAllowedUserIds,
  getInGroupDids,
  getUser,
  listCampaignsUsingInGroup,
  parseStaticWhitelist,
} from '@dialeros/control-plane';
import { InlineCardForm } from '@/components/inline-card-form';
import { DeleteInGroupButton } from './delete-button';

export const dynamic = 'force-dynamic';

export default async function InGroupDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const g = getInGroup(id);
  if (!g) notFound();

  const staticList = parseStaticWhitelist(g);
  const dids = getInGroupDids(id);

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/in-groups"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          ← In-Groups
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">{g.name}</h1>
        {g.enabled === 1 ? (
          <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
            ENABLED
          </span>
        ) : (
          <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
            DISABLED
          </span>
        )}
      </div>
      <p className="text-fg-subtle text-sm font-mono mb-4">{g.type}</p>

      <div className="max-w-4xl mb-6">
        <InlineCardForm
          title="Basics"
          endpoint={`/api/in-groups/${g.id}`}
          fields={[
            {
              type: 'text',
              name: 'name',
              label: 'Name',
              value: g.name,
              maxLength: 64,
              hint: 'Internal identifier. Letters, digits, dashes, underscores only — what agents and admins see in nav.',
            },
            {
              type: 'textarea',
              name: 'description',
              label: 'Description',
              value: g.description,
              maxLength: 500,
              hint: 'Free-form notes for other admins. 500 characters max.',
            },
            {
              type: 'boolean',
              name: 'enabled',
              label: 'Enabled',
              value: g.enabled === 1,
              hint: 'Disabled in-groups still exist but reject inbound calls. Used to take a queue offline without deleting.',
            },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mb-6">
        <InlineCardForm
          title="Whitelist"
          endpoint={`/api/in-groups/${g.id}`}
          fields={[
            {
              type: 'select',
              name: 'whitelist_mode',
              label: 'Mode',
              value: g.whitelist_mode,
              options: [
                { value: 'none', label: 'none — anyone can call' },
                {
                  value: 'static',
                  label: 'static — only listed callers',
                },
                {
                  value: 'cluster_wide_leads',
                  label: 'cluster_wide_leads — only callers in any lead list',
                },
              ],
              hint: 'none allows every inbound caller; static checks the list below; cluster_wide_leads accepts callers whose number is in any lead list across the system.',
            },
            {
              type: 'select',
              name: 'off_list_action',
              label: 'Off-list action',
              value: g.off_list_action,
              options: [
                { value: 'reject', label: 'reject (hangup)' },
                {
                  value: 'fallback_announcement',
                  label: 'fallback_announcement — play notice + drop',
                },
              ],
              hint: 'What to do when a caller fails the whitelist. reject = silent drop; fallback_announcement = play a configured notice then drop.',
            },
            {
              type: 'lines',
              name: 'whitelist_static',
              label: `Allowed numbers (${staticList.length})`,
              value: staticList,
              placeholder: '+14155551234\n+14155551235',
              hint: 'One phone number per line. Only used when mode is static. Empty lines ignored.',
            },
          ]}
        />

        <InlineCardForm
          title="Routing"
          endpoint={`/api/in-groups/${g.id}`}
          fields={[
            {
              type: 'select',
              name: 'routing_strategy',
              label: 'Strategy',
              value: g.routing_strategy,
              options: [
                { value: 'ring_all', label: 'ring_all — every available agent rings' },
                {
                  value: 'longest_idle',
                  label: 'longest_idle — agent waiting longest gets it',
                },
                { value: 'random', label: 'random' },
              ],
              hint: 'How a free agent is picked when a call lands. ring_all rings every available agent at once (first to pick wins); longest_idle picks who has been waiting longest; random distributes uniformly.',
            },
            {
              type: 'number',
              name: 'max_wait_seconds',
              label: 'Max wait (seconds)',
              value: g.max_wait_seconds,
              min: 5,
              max: 3600,
              step: 1,
              hint: 'How long a caller waits in queue before off_list_action fires. 5–3600.',
            },
            {
              type: 'number',
              name: 'wrap_up_seconds',
              label: 'Wrap-up (seconds)',
              value: g.wrap_up_seconds,
              min: 0,
              max: 600,
              step: 1,
              hint: 'How long an agent is held after a call ends, to disposition before the next call lands. 0–600.',
            },
          ]}
        />
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted">
            DIDs ({dids.length})
          </h2>
          <Link
            href="/dids/add"
            className="text-xs text-fg-muted hover:text-fg"
          >
            Add DIDs →
          </Link>
        </div>
        <p className="text-xs text-fg-subtle mb-3">
          Phone numbers that route inbound calls here. Manage DIDs (add,
          move, clone, delete) on the{' '}
          <Link href="/dids" className="text-accent hover:underline">
            DIDs page
          </Link>
          .
        </p>
        {dids.length === 0 ? (
          <p className="text-fg-subtle text-sm">
            No DIDs attached. Inbound calls have nowhere to land.
          </p>
        ) : (
          <ul className="font-mono text-xs space-y-1 max-h-60 overflow-y-auto">
            {dids.map((d) => (
              <li key={d}>
                <Link
                  href={`/dids/${encodeURIComponent(d)}`}
                  className="hover:underline"
                >
                  {d}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CampaignsUsingCard inGroupId={id} />

      <AllowedUsersCard inGroupId={id} />

      <dl className="grid grid-cols-2 gap-3 text-xs max-w-4xl">
        <Detail label="ID" value={<span className="font-mono">{g.id}</span>} />
        <Detail
          label="Created"
          value={new Date(g.created_at).toLocaleString()}
        />
      </dl>

      <div className="mt-8 max-w-4xl flex items-center gap-4">
        <DeleteInGroupButton id={g.id} name={g.name} didCount={dids.length} />
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

function CampaignsUsingCard({ inGroupId }: { inGroupId: string }) {
  const campaigns = listCampaignsUsingInGroup(inGroupId);
  return (
    <div className="border border-border rounded p-4 mb-6 max-w-4xl">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
        Campaigns referencing this in-group ({campaigns.length})
      </h2>
      {campaigns.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No campaign currently picks up calls from this in-group. Attach
          this in-group on a campaign to start routing.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {campaigns.map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <Link
                href={`/campaigns/${c.id}`}
                className="hover:underline"
              >
                {c.name}
              </Link>
              <span className="text-fg-subtle text-xs uppercase">
                {c.status}
              </span>
              <span className="text-fg-subtle text-xs font-mono">
                {c.type}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AllowedUsersCard({ inGroupId }: { inGroupId: string }) {
  const userIds = getInGroupAllowedUserIds(inGroupId);
  const users = userIds.map((id) => getUser(id)).filter(Boolean);
  return (
    <div className="border border-border rounded p-4 mb-6 max-w-4xl">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
        Attached agents ({users.length})
      </h2>
      {users.length === 0 ? (
        <p className="text-fg-subtle text-sm">
          No users attached. Edit a user&apos;s detail page to attach them to
          this in-group.
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
