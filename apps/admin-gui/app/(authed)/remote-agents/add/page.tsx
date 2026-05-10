import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listCampaigns, listNodesFromDb } from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { AddRemoteAgentForm } from './add-form';

export const dynamic = 'force-dynamic';

export default async function AddRemoteAgentPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  const telephonyNodes = listNodesFromDb()
    .filter((n) => n.role === 'telephony')
    .map((n) => ({ id: n.id, name: n.name, host: n.host }));
  const campaigns = listCampaigns().map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
  }));

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/remote-agents"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          ← Remote Agents
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-4">New Remote Agent</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-2xl">
        Register an external SIP endpoint as a member of the pacing
        pool. Pick the telephony node where this endpoint lives, type
        the extension or user, and the SIP URI is constructed for you.
      </p>
      {telephonyNodes.length === 0 ? (
        <div className="border border-warn/40 bg-warn/5 text-warn rounded p-4 max-w-2xl text-sm">
          <div className="font-medium mb-1">
            No telephony nodes registered yet.
          </div>
          <p className="text-fg-muted text-xs mb-2">
            Remote agents bind to a telephony node so the pacer knows
            where to send the SIP INVITE. Add one first:
          </p>
          <Link
            href="/cluster/nodes/add"
            className="text-accent hover:underline text-xs"
          >
            Add a telephony node →
          </Link>
        </div>
      ) : (
        <AddRemoteAgentForm nodes={telephonyNodes} campaigns={campaigns} />
      )}
    </div>
  );
}
