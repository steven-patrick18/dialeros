import Link from 'next/link';
import {
  getCampaign,
  leadCountFor,
  listLeadLists,
} from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

export default async function LeadListsPage() {
  const lists = listLeadLists();
  // Resolve campaign names in one pass (small N, fine to N+1 for now).
  const campaignName = (id: string | null) =>
    id ? (getCampaign(id)?.name ?? '(missing)') : null;

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
        Lead lists hold the phone numbers a campaign will dial. Each list
        belongs to at most one campaign at a time — move a list between
        campaigns from its detail page.
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
              <th className="font-medium">Campaign</th>
              <th className="font-medium tabular-nums">Leads</th>
              <th className="font-medium">Status</th>
              <th className="font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            {lists.map((l) => {
              const cName = campaignName(l.campaign_id);
              return (
                <tr key={l.id} className="border-b border-border/50">
                  <td className="py-3">
                    <Link href={`/leads/${l.id}`} className="hover:underline">
                      {l.name}
                    </Link>
                  </td>
                  <td>
                    {l.campaign_id ? (
                      <Link
                        href={`/campaigns/${l.campaign_id}`}
                        className="hover:underline"
                      >
                        {cName}
                      </Link>
                    ) : (
                      <span className="text-fg-subtle text-xs">unattached</span>
                    )}
                  </td>
                  <td className="text-fg tabular-nums">{leadCountFor(l.id)}</td>
                  <td>
                    <span className="text-fg-muted text-xs uppercase">
                      {l.status}
                    </span>
                  </td>
                  <td className="text-fg-muted text-xs max-w-xs truncate">
                    {l.description ?? '—'}
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
