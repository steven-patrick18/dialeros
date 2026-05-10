import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listNodesFromDb } from '@dialeros/control-plane';
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
  const telephonyNodes = listNodesFromDb().filter(
    (n) => n.role === 'telephony',
  );

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
        pool. Each remote agent has a <span className="font-mono">lines</span>{' '}
        capacity that the pacer multiplies by the campaign&apos;s{' '}
        <span className="font-mono">dial_level</span> when deciding how
        many calls to originate per tick.
      </p>
      <AddRemoteAgentForm
        nodes={telephonyNodes.map((n) => ({ id: n.id, name: n.name }))}
      />
    </div>
  );
}
