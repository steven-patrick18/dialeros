import Link from 'next/link';
import { listAllDids, listInGroups } from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

export default async function DidsPage() {
  const dids = listAllDids();
  const inGroups = listInGroups();
  const inGroupCount = inGroups.length;

  // Group by in-group for the summary panel.
  const byGroup = new Map<string, number>();
  for (const d of dids) {
    byGroup.set(d.in_group_id, (byGroup.get(d.in_group_id) ?? 0) + 1);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1 max-w-5xl">
        <h1 className="text-2xl font-semibold">DIDs</h1>
        <Link
          href="/dids/add"
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm"
        >
          Add DIDs
        </Link>
      </div>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        Inbound phone numbers that route calls to an in-group. Add one or
        many at a time, move a DID between in-groups, or clone an existing
        DID&apos;s settings to a new number.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mb-6">
        <Stat label="DIDs" value={dids.length.toLocaleString()} />
        <Stat label="In-groups" value={inGroupCount.toLocaleString()} />
        <Stat
          label="Routed"
          value={byGroup.size.toLocaleString()}
          hint="in-groups with at least one DID"
        />
        <Stat
          label="Empty in-groups"
          value={(inGroupCount - byGroup.size).toLocaleString()}
          hint="no DIDs attached"
        />
      </div>

      <div className="border border-border rounded max-w-5xl">
        {dids.length === 0 ? (
          <p className="text-fg-subtle text-sm p-4">
            No DIDs configured yet. Use{' '}
            <Link href="/dids/add" className="text-accent hover:underline">
              Add DIDs
            </Link>{' '}
            to attach one or many phone numbers to an in-group.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-2 px-3 font-medium">DID</th>
                <th className="font-medium">In-group</th>
                <th className="font-medium">State</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {dids.map((d) => (
                <tr
                  key={d.did}
                  className="border-b border-border/50 last:border-0"
                >
                  <td className="py-2 px-3 font-mono">{d.did}</td>
                  <td>
                    <Link
                      href={`/in-groups/${d.in_group_id}`}
                      className="hover:underline"
                    >
                      {d.in_group_name}
                    </Link>
                  </td>
                  <td>
                    {d.in_group_enabled === 1 ? (
                      <span className="text-success text-xs uppercase">
                        enabled
                      </span>
                    ) : (
                      <span className="text-fg-muted text-xs uppercase">
                        disabled
                      </span>
                    )}
                  </td>
                  <td className="text-right py-2 px-3">
                    <Link
                      href={`/dids/${encodeURIComponent(d.did)}`}
                      className="text-xs text-fg-muted hover:text-fg"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border border-border rounded p-3">
      <div className="text-xs text-fg-subtle uppercase">{label}</div>
      <div className="text-xl mt-1 tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-fg-subtle mt-1">{hint}</div>}
    </div>
  );
}
