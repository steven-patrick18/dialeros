import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getUser,
  getUserCampaignIds,
  getUserInGroupIds,
  listCampaigns,
  listInGroups,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { EditUserForm } from './edit-form';
import { DeactivateButton } from './deactivate-button';
import { AttachmentsForm } from './attachments-form';

export const dynamic = 'force-dynamic';

export default async function UserDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const { id } = await params;
  const u = getUser(id);
  if (!u) notFound();

  const isMe = id === me.id;
  const isInactive = u.is_active === 0;

  return (
    <div>
      <div className="mb-1">
        <Link href="/users" className="text-xs text-fg-subtle hover:text-fg-muted">
          ← Users
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">{u.username}</h1>
        {isInactive ? (
          <span className="bg-error/10 text-error border border-error/50 px-2 py-0.5 rounded text-xs">
            INACTIVE
          </span>
        ) : (
          <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
            ACTIVE
          </span>
        )}
      </div>
      {u.display_name && (
        <p className="text-fg-muted text-sm mb-6">{u.display_name}</p>
      )}

      <div className="border border-border rounded p-4 max-w-2xl mb-6">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Edit
        </h2>
        <EditUserForm
          user={{
            id: u.id,
            username: u.username,
            email: u.email,
            role: u.role,
            display_name: u.display_name,
            skill_tier: u.skill_tier,
          }}
          isSelf={isMe}
        />
      </div>

      <div className="border border-border rounded p-4 max-w-2xl mb-6">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Attachments
        </h2>
        <p className="text-xs text-fg-subtle mb-3">
          {u.role === 'admin' || u.role === 'supervisor' ? (
            <>
              {u.role === 'admin' ? 'Admins' : 'Supervisors'} can join all
              campaigns + in-groups by default. Explicit attachments below are
              advisory and have no enforcement effect for this role.
            </>
          ) : (
            <>
              Agents can only join campaigns + receive from in-groups they&apos;re
              attached to here. Empty = no access.
            </>
          )}
        </p>
        <AttachmentsForm
          userId={u.id}
          campaigns={listCampaigns().map((c) => ({ id: c.id, name: c.name }))}
          inGroups={listInGroups().map((g) => ({ id: g.id, name: g.name }))}
          initialCampaignIds={getUserCampaignIds(u.id)}
          initialInGroupIds={getUserInGroupIds(u.id)}
        />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs max-w-2xl">
        <Detail label="ID" value={<span className="font-mono">{u.id}</span>} />
        <Detail
          label="Created"
          value={new Date(u.created_at).toLocaleString()}
        />
        <Detail
          label="Updated"
          value={new Date(u.updated_at).toLocaleString()}
        />
      </dl>

      <div className="mt-8 max-w-2xl">
        <DeactivateButton
          id={u.id}
          username={u.username}
          isSelf={isMe}
          isInactive={isInactive}
        />
      </div>
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
    <div>
      <dt className="text-fg-subtle uppercase">{label}</dt>
      <dd className="text-fg mt-0.5">{value}</dd>
    </div>
  );
}
