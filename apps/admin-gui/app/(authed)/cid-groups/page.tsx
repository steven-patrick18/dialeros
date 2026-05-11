import Link from 'next/link';
import { countCidsInGroup, listCidGroups } from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

const STRATEGY_LABEL: Record<string, string> = {
  rotate: 'rotate',
  random: 'random',
  sticky_by_area: 'sticky by area',
};

export default async function CidGroupsList() {
  const groups = listCidGroups();
  const counts = new Map(groups.map((g) => [g.id, countCidsInGroup(g.id)]));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">CID Groups</h1>
        <Link
          href="/cid-groups/add"
          className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded text-sm"
        >
          + Add CID Group
        </Link>
      </div>

      <p className="text-fg-subtle text-sm mb-6 max-w-2xl">
        A CID group is a reusable pool of caller-IDs with its own rotation
        logic (round-robin, random, or sticky-by-area). Route plans attach
        one or more groups; the pacer rotates across groups per call and
        then applies the chosen group&apos;s strategy.
      </p>

      {groups.length === 0 ? (
        <div className="border border-dashed border-border rounded p-8 text-center max-w-2xl">
          <p className="text-fg-muted">No CID groups defined.</p>
          <p className="text-fg-subtle text-sm mt-2">
            Click <span className="font-mono text-fg-muted">+ Add CID Group</span>{' '}
            to create one, then bulk-paste your numbers.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm max-w-3xl">
          <thead className="text-left text-fg-subtle border-b border-border">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="font-medium">Strategy</th>
              <th className="font-medium text-right">Numbers</th>
              <th className="font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="border-b border-border/50">
                <td className="py-3">
                  <Link
                    href={`/cid-groups/${g.id}`}
                    className="hover:underline"
                  >
                    {g.name}
                  </Link>
                </td>
                <td className="text-fg-muted">
                  {STRATEGY_LABEL[g.strategy] ?? g.strategy}
                </td>
                <td className="text-right tabular-nums">
                  {counts.get(g.id)?.toLocaleString() ?? 0}
                </td>
                <td className="text-fg-subtle">{g.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
