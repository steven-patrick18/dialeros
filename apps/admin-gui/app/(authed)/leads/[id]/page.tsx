import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getCampaign,
  getLeadList,
  leadBreakdown,
  leadCountFor,
  listCampaigns,
  pageLeads,
} from '@dialeros/control-plane';
import { UploadCsvForm } from './upload-form';
import { DeleteLeadListButton } from './delete-button';
import { MoveListPicker } from './move-picker';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function LeadListDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const list = getLeadList(id);
  if (!list) notFound();

  const total = leadCountFor(id);
  const breakdown = leadBreakdown(id);
  const page = Math.max(1, Number(sp.page ?? 1));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const leads = pageLeads(id, page, PAGE_SIZE);
  const ownerCampaign = list.campaign_id
    ? getCampaign(list.campaign_id)
    : null;
  const allCampaigns = listCampaigns();

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/leads"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          ← Lead Lists
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">{list.name}</h1>
      {list.description && (
        <p className="text-fg-muted text-sm mb-2">{list.description}</p>
      )}
      <p className="text-fg-subtle text-xs mb-6">
        {total.toLocaleString()} leads · created{' '}
        {new Date(list.created_at).toLocaleString()}
      </p>

      <div className="border border-border rounded p-4 max-w-4xl mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted">
            Campaign assignment
          </h2>
          <span className="text-fg text-sm">
            {ownerCampaign ? (
              <Link
                href={`/campaigns/${ownerCampaign.id}`}
                className="hover:underline"
              >
                {ownerCampaign.name}
              </Link>
            ) : (
              <span className="text-fg-subtle">unattached</span>
            )}
          </span>
        </div>
        <p className="text-xs text-fg-subtle mb-3">
          A list belongs to at most one campaign. Moving it points the pacer
          at this list&apos;s leads on the next tick — no service restart.
        </p>
        <MoveListPicker
          listId={list.id}
          currentCampaignId={list.campaign_id}
          campaigns={allCampaigns.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
          }))}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mb-6">
        <div className="border border-border rounded p-4">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
            Status breakdown
          </h2>
          {breakdown.length === 0 ? (
            <p className="text-fg-subtle text-sm">No leads yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {breakdown.map((b) => (
                <li
                  key={b.status}
                  className="flex justify-between items-center"
                >
                  <span className="font-mono text-xs text-fg-muted">
                    {b.status}
                  </span>
                  <span className="tabular-nums text-fg">
                    {b.count.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border border-border rounded p-4">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
            Upload CSV
          </h2>
          <UploadCsvForm listId={id} />
        </div>
      </div>

      {leads.length > 0 && (
        <div className="max-w-5xl">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium">
              Leads ({(page - 1) * PAGE_SIZE + 1}–
              {Math.min(page * PAGE_SIZE, total)} of{' '}
              {total.toLocaleString()})
            </h2>
            <div className="flex gap-2 text-xs">
              {page > 1 && (
                <Link
                  href={`/leads/${id}?page=${page - 1}`}
                  className="px-2 py-1 border border-border rounded hover:bg-card-hover"
                >
                  ← prev
                </Link>
              )}
              {page < totalPages && (
                <Link
                  href={`/leads/${id}?page=${page + 1}`}
                  className="px-2 py-1 border border-border rounded hover:bg-card-hover"
                >
                  next →
                </Link>
              )}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-2 font-medium">Phone</th>
                <th className="font-medium">Name</th>
                <th className="font-medium">Email</th>
                <th className="font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id} className="border-b border-border/50">
                  <td className="py-2 font-mono text-fg">{lead.phone}</td>
                  <td className="text-fg-muted">{lead.name ?? '—'}</td>
                  <td className="text-fg-muted">{lead.email ?? '—'}</td>
                  <td>
                    <span className="font-mono text-xs text-fg-muted">
                      {lead.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 max-w-5xl">
        <DeleteLeadListButton id={list.id} name={list.name} count={total} />
      </div>
    </div>
  );
}
