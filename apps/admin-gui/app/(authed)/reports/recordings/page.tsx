import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getSelfNode,
  listNodesFromDb,
  listRecordingsByNode,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Iter 182 — Per-node recording rollup. Surfaces:
//   - count of recorded calls bucketed by recording_node_id
//   - cached byte total per node (NULL bytes shown as 'unknown')
//   - which bucket is local (self) vs remote
//
// 'unknown' recording_node_id rows are legacy / pre-iter-182
// or originated from a node not yet promoted via cluster
// bootstrap. They render under '— unknown —' so they don't
// silently vanish.

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[i]}`;
}

export default async function RecordingsReportPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Recordings</h1>
        <p className="text-error text-sm">
          Admin or supervisor role required.
        </p>
      </div>
    );
  }

  const rollup = JSON.parse(
    JSON.stringify(listRecordingsByNode()),
  ) as ReturnType<typeof listRecordingsByNode>;
  const nodes = JSON.parse(
    JSON.stringify(listNodesFromDb()),
  ) as ReturnType<typeof listNodesFromDb>;
  const self = getSelfNode();
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const totalCount = rollup.reduce((a, r) => a + r.count, 0);
  const totalBytes = rollup.reduce((a, r) => a + r.total_bytes, 0);

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-1">Recordings by node</h1>
      <p className="text-fg-subtle text-sm mb-6">
        Cross-cluster recording storage rollup. Each recorded call
        is tagged with the node whose FreeSWITCH wrote the .wav at
        record-finish time. Legacy rows without a tag bucket under
        &lsquo;— unknown —&rsquo;. Total: {totalCount} recordings ·{' '}
        {fmtBytes(totalBytes)} cached.
      </p>
      <table className="w-full text-sm border border-border rounded">
        <thead className="bg-card">
          <tr className="text-left">
            <th className="px-3 py-2">Node</th>
            <th className="px-3 py-2">Host</th>
            <th className="px-3 py-2">Count</th>
            <th className="px-3 py-2">Bytes cached</th>
            <th className="px-3 py-2">Bytes known / unknown</th>
            <th className="px-3 py-2">Local?</th>
          </tr>
        </thead>
        <tbody>
          {rollup.map((r) => {
            const isUnknown = r.recording_node_id === '__unknown__';
            const n = isUnknown ? undefined : nodeById.get(r.recording_node_id);
            const local = self && r.recording_node_id === self.id;
            return (
              <tr key={r.recording_node_id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs">
                  {isUnknown ? (
                    <span className="text-fg-muted">— unknown —</span>
                  ) : (
                    (n?.name ?? r.recording_node_id)
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-fg-subtle">
                  {n?.host ?? '—'}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.count}</td>
                <td className="px-3 py-2 tabular-nums">
                  {fmtBytes(r.total_bytes)}
                </td>
                <td className="px-3 py-2 text-xs text-fg-subtle tabular-nums">
                  {r.bytes_known} / {r.bytes_unknown}
                </td>
                <td className="px-3 py-2 text-xs">
                  {local ? (
                    <span className="text-success">local</span>
                  ) : isUnknown ? (
                    <span className="text-fg-muted">—</span>
                  ) : (
                    <span className="text-warn">remote</span>
                  )}
                </td>
              </tr>
            );
          })}
          {rollup.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-fg-muted">
                No recordings yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="text-xs text-fg-subtle mt-4">
        Remote-node recordings currently return HTTP 409 from{' '}
        <span className="font-mono">/api/recordings/&lt;id&gt;</span> with
        a structured payload pointing at the owning node. A
        cross-node SSH-stream proxy ships in a follow-up iter.
        Manage nodes from{' '}
        <Link href="/cluster/nodes" className="text-link hover:underline">
          /cluster/nodes
        </Link>
        .
      </p>
    </div>
  );
}
