import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  PERMISSION_CATALOG,
  effectivePermissions,
  getUser,
  getUserCampaignIds,
  getUserInGroupIds,
  listCampaigns,
  listInGroups,
  listNodesFromDb,
  parseNodeRoles,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { InlineCardForm } from '@/components/inline-card-form';
import { DeactivateButton } from './deactivate-button';
import { AttachmentsForm } from './attachments-form';
import { PhonesPanel } from './phones-panel';
import { AccessPanel } from './access-panel';
import { UserActivityPanel } from './activity-panel';

const ROLES = ['admin', 'supervisor', 'operator', 'agent'] as const;
const TIERS = ['new', 'certified', 'expert'] as const;

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
  const telephonyNodes = listNodesFromDb()
    .filter((n) => parseNodeRoles(n).includes('telephony'))
    .map((n) => ({ id: n.id, name: n.name, host: n.host }));

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

      {/* Iter 129 — supervisor activity + diagnostics card. Shows
          today's scoreboard, common misconfig checks, and the
          most recent dial-intents + audit events for bug hunting
          ("what was this agent doing before X happened?"). */}
      <UserActivityPanel user={u} />

      <div className="max-w-2xl mb-6">
        <InlineCardForm
          title="Profile"
          endpoint={`/api/users/${u.id}`}
          method="PATCH"
          fields={[
            {
              type: 'text',
              name: 'display_name',
              label: 'Display name',
              value: u.display_name,
              maxLength: 120,
            },
            {
              type: 'text',
              name: 'email',
              label: 'Email',
              value: u.email,
              hint: 'Optional. Used for password resets and notifications.',
            },
            {
              type: 'select',
              name: 'role',
              label: 'Role',
              value: u.role,
              options: ROLES.map((r) => ({ value: r, label: r })),
              hint: isMe
                ? 'Heads up — changing your own role from admin can lock you out.'
                : 'admin = full access; supervisor = read-only + take-over; agent = call only; operator = no telephony.',
            },
            {
              type: 'select',
              name: 'skill_tier',
              label: 'Skill tier',
              value: u.skill_tier,
              options: TIERS.map((t) => ({ value: t, label: t })),
              hint: 'Pacer can prefer higher-tier agents when wiring weighted routing (planned).',
            },
            {
              type: 'boolean',
              name: 'manual_dial',
              label: 'Manual dial (expert)',
              value: u.manual_dial === 1,
              hint: 'When on, this agent’s softphone exposes a dial input — they can place outbound calls manually. Off = auto-answer pacer-bridged calls only.',
            },
            {
              type: 'password',
              name: 'password',
              label: 'New password',
              value: null,
              placeholder: '●●●●●●●● (unchanged)',
              hint: 'Leave blank to keep the current password. Minimum 8 characters.',
            },
          ]}
        />
      </div>

      <div className="border border-border rounded p-4 max-w-3xl mb-6">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Access
        </h2>
        <AccessPanel
          userId={u.id}
          role={u.role}
          isAdmin={u.role === 'admin'}
          catalog={PERMISSION_CATALOG.map((p) => ({
            slug: p.slug,
            label: p.label,
            group: p.group,
          }))}
          initialGranted={effectivePermissions(u)}
          initialOverridden={u.permissions !== null}
        />
      </div>

      <div className="border border-border rounded p-4 max-w-2xl mb-6">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Phones
        </h2>
        <p className="text-xs text-fg-subtle mb-3">
          SIP credentials owned by this user. The primary phone is what
          the browser softphone registers as and what the pacer bridges
          live calls to. Multiple phones let one user use a desk phone +
          a softphone, etc.
        </p>
        <PhonesPanel userId={u.id} telephonyNodes={telephonyNodes} />
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
