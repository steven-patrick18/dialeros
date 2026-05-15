import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/session';
import { NodeLoadClient } from './client';

export const dynamic = 'force-dynamic';

// Iter 191 — Real-time per-node load dashboard. Distinct from
// /cluster/nodes (which manages the node inventory); this is the
// live operational view: CPU load, RAM, disk, FreeSWITCH
// channels, uptime — every node, refreshing every 5s.

export default async function ClusterLoadPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Cluster load</h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Cluster load</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Live load across every node — CPU (load average vs core
        count), RAM, disk, FreeSWITCH channels, uptime. Auto-
        refreshes every 5s. The self node is probed locally;
        remote nodes over the cluster SSH key. Manage the node
        inventory on <a href="/cluster/nodes"
        className="text-link hover:underline">/cluster/nodes</a>.
      </p>
      <NodeLoadClient />
    </div>
  );
}
