import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getInGroup,
  getInGroupAllowedUserIds,
  getInGroupDids,
  getUser,
  parseStaticWhitelist,
} from '@dialeros/control-plane';
import { DidManager } from './did-manager';
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
      <p className="text-fg-subtle text-sm font-mono mb-1">{g.type}</p>
      {g.description && (
        <p className="text-fg-muted text-sm mb-6">{g.description}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mb-6">
        <Card title="Whitelist">
          <Detail label="Mode" value={<span className="font-mono text-xs">{g.whitelist_mode}</span>} />
          {g.whitelist_mode === 'static' && (
            <Detail
              label="Allowed numbers"
              value={
                <span className="tabular-nums">{staticList.length}</span>
              }
            />
          )}
          {g.whitelist_mode === 'static' && staticList.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-fg-subtle hover:text-fg-muted">
                Show numbers
              </summary>
              <ul className="mt-2 max-h-40 overflow-y-auto space-y-0.5 font-mono text-fg-muted">
                {staticList.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </details>
          )}
          <Detail
            label="Off-list action"
            value={<span className="font-mono text-xs">{g.off_list_action}</span>}
          />
        </Card>

        <Card title="Routing">
          <Detail
            label="Strategy"
            value={<span className="font-mono text-xs">{g.routing_strategy}</span>}
          />
          <Detail
            label="Max wait"
            value={<span className="tabular-nums">{g.max_wait_seconds}s</span>}
          />
          <Detail
            label="Wrap-up"
            value={<span className="tabular-nums">{g.wrap_up_seconds}s</span>}
          />
        </Card>
      </div>

      <div className="border border-border rounded p-4 mb-6 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          DIDs ({dids.length})
        </h2>
        <p className="text-xs text-fg-subtle mb-3">
          Phone numbers that route inbound calls to this in-group. A DID can
          only belong to one in-group at a time.
        </p>
        <DidManager id={id} dids={dids} />
      </div>

      <AllowedUsersCard inGroupId={id} />

      <dl className="grid grid-cols-2 gap-3 text-xs max-w-4xl">
        <Detail label="ID" value={<span className="font-mono">{g.id}</span>} />
        <Detail
          label="Created"
          value={new Date(g.created_at).toLocaleString()}
        />
      </dl>

      <div className="mt-8 max-w-4xl">
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
