import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getDidWithOwner,
  getInGroup,
  listCampaignsUsingInGroup,
  listInGroups,
} from '@dialeros/control-plane';
import { ManageDid } from './manage';

export const dynamic = 'force-dynamic';

export default async function DidDetail({
  params,
}: {
  params: Promise<{ did: string }>;
}) {
  const { did } = await params;
  const decoded = decodeURIComponent(did);
  const owner = getDidWithOwner(decoded);
  if (!owner) notFound();

  const group = getInGroup(owner.in_group_id);
  const campaignsUsingGroup = listCampaignsUsingInGroup(owner.in_group_id);
  const inGroups = listInGroups();

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/dids"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          ← DIDs
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1 max-w-4xl">
        <h1 className="text-2xl font-semibold font-mono">{owner.did}</h1>
        {owner.in_group_enabled === 1 ? (
          <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
            ROUTED
          </span>
        ) : (
          <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
            DISABLED IN-GROUP
          </span>
        )}
      </div>
      <p className="text-fg-subtle text-sm mb-6">
        Inbound calls to this number land in the in-group below, then route
        to whichever campaign + agents claim the in-group.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mb-6">
        <Card title="In-group">
          {group ? (
            <Link
              href={`/in-groups/${group.id}`}
              className="hover:underline text-sm"
            >
              {group.name}
            </Link>
          ) : (
            <p className="text-error text-sm">missing</p>
          )}
          <p className="text-xs text-fg-subtle mt-2">
            Move this DID to a different in-group below to redirect its
            traffic without losing the number.
          </p>
        </Card>

        <Card title={`Campaigns referencing this in-group (${campaignsUsingGroup.length})`}>
          {campaignsUsingGroup.length === 0 ? (
            <p className="text-fg-subtle text-sm">
              No campaign currently picks up calls from this in-group.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {campaignsUsingGroup.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/campaigns/${c.id}`}
                    className="hover:underline"
                  >
                    {c.name}
                  </Link>
                  <span className="text-fg-subtle text-xs ml-2 uppercase">
                    {c.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ManageDid
        did={owner.did}
        currentInGroupId={owner.in_group_id}
        inGroups={inGroups.map((g) => ({
          id: g.id,
          name: g.name,
          enabled: g.enabled === 1,
        }))}
      />
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
    <div className="border border-border rounded p-4">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        {title}
      </h2>
      {children}
    </div>
  );
}
