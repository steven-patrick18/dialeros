import Link from 'next/link';
import { getInGroupDids, listInGroups } from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

export default async function InGroupsPage() {
  const groups = listInGroups();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">In-Groups</h1>
        <Link
          href="/in-groups/add"
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm"
        >
          + New In-Group
        </Link>
      </div>

      <p className="text-fg-subtle text-sm mb-6 max-w-2xl">
        In-groups are the queues callers land in. Inbound DIDs route to one
        in-group. Agents (or AI workers) staffed against the in-group's
        campaign answer the calls.
      </p>

      {groups.length === 0 ? (
        <div className="border border-dashed border-border rounded p-8 text-center max-w-2xl">
          <p className="text-fg-muted">No in-groups configured.</p>
          <p className="text-fg-subtle text-sm mt-2">
            Click <span className="font-mono text-fg-muted">+ New In-Group</span>{' '}
            to create one.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-fg-subtle border-b border-border">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="font-medium">Type</th>
              <th className="font-medium">Whitelist</th>
              <th className="font-medium">Routing</th>
              <th className="font-medium tabular-nums">DIDs</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="border-b border-border/50">
                <td className="py-3">
                  <Link
                    href={`/in-groups/${g.id}`}
                    className="hover:underline"
                  >
                    {g.name}
                  </Link>
                </td>
                <td className="text-fg-muted text-xs font-mono">{g.type}</td>
                <td className="text-fg-muted text-xs font-mono">
                  {g.whitelist_mode}
                </td>
                <td className="text-fg-muted text-xs font-mono">
                  {g.routing_strategy}
                </td>
                <td className="text-fg tabular-nums">
                  {getInGroupDids(g.id).length}
                </td>
                <td>
                  {g.enabled === 1 ? (
                    <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
                      ENABLED
                    </span>
                  ) : (
                    <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
                      DISABLED
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
