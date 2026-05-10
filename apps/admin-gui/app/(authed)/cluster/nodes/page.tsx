import Link from 'next/link';
import {
  listNodesFromDb,
  parseNodeRoles,
  type NodeRecord,
  type NodeStatus,
} from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

export default async function NodesList() {
  const nodes = listNodesFromDb();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Cluster Nodes</h1>
        <Link
          href="/cluster/nodes/add"
          className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded text-sm"
        >
          + Add Node
        </Link>
      </div>

      {nodes.length === 0 ? (
        <div className="border border-dashed border-border rounded p-8 text-center">
          <p className="text-fg-muted">No nodes registered.</p>
          <p className="text-fg-subtle text-sm mt-2">
            Click <span className="font-mono text-fg-muted">+ Add Node</span> to provision your first.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-fg-subtle border-b border-border">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="font-medium">Host</th>
              <th className="font-medium">Roles</th>
              <th className="font-medium">Status</th>
              <th className="font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n: NodeRecord) => {
              const roles = parseNodeRoles(n);
              return (
                <tr key={n.id} className="border-b border-border/50">
                  <td className="py-3">
                    <Link
                      href={`/cluster/nodes/${n.id}`}
                      className="hover:underline"
                    >
                      {n.name}
                    </Link>
                    {n.is_self === 1 && (
                      <span className="text-fg-subtle text-xs ml-2 uppercase tracking-wide">
                        (this host)
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-fg-muted">
                    {n.host}:{n.port}
                  </td>
                  <td className="text-fg-muted">
                    <span className="flex flex-wrap gap-1">
                      {roles.map((r) => (
                        <span
                          key={r}
                          className="bg-card-hover/60 text-fg-muted border border-border px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide"
                        >
                          {r}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={n.status} />
                  </td>
                  <td className="text-fg-subtle">
                    {new Date(n.created_at).toLocaleString()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: NodeStatus }) {
  const styles: Record<NodeStatus, string> = {
    PROVISIONING: 'bg-warn/15 text-warn border-warn/50',
    READY: 'bg-success/15 text-success border-success/50',
    FAILED: 'bg-error/15 text-error border-error/50',
  };
  return (
    <span className={`${styles[status]} border px-2 py-0.5 rounded text-xs`}>
      {status}
    </span>
  );
}
