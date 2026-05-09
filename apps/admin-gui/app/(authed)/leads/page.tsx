import Link from 'next/link';
import { leadCountFor, listLeadLists } from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

export default async function LeadListsPage() {
  const lists = listLeadLists();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Lead Lists</h1>
        <Link
          href="/leads/add"
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm"
        >
          + New List
        </Link>
      </div>

      <p className="text-fg-subtle text-sm mb-6 max-w-2xl">
        Lead lists hold the phone numbers a campaign will dial. Upload via CSV
        or push leads through the API. Future campaigns will reference lists by
        name.
      </p>

      {lists.length === 0 ? (
        <div className="border border-dashed border-border rounded p-8 text-center max-w-2xl">
          <p className="text-fg-muted">No lead lists yet.</p>
          <p className="text-fg-subtle text-sm mt-2">
            Click <span className="font-mono text-fg-muted">+ New List</span> to
            create one, then upload a CSV with phone numbers.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-fg-subtle border-b border-border">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="font-medium">Description</th>
              <th className="font-medium tabular-nums">Leads</th>
              <th className="font-medium">Status</th>
              <th className="font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {lists.map((l) => (
              <tr key={l.id} className="border-b border-border/50">
                <td className="py-3">
                  <Link href={`/leads/${l.id}`} className="hover:underline">
                    {l.name}
                  </Link>
                </td>
                <td className="text-fg-muted text-xs max-w-xs truncate">
                  {l.description ?? '—'}
                </td>
                <td className="text-fg tabular-nums">{leadCountFor(l.id)}</td>
                <td>
                  <span className="text-fg-muted text-xs uppercase">
                    {l.status}
                  </span>
                </td>
                <td className="text-fg-subtle">
                  {new Date(l.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
