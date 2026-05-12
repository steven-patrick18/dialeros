import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getCampaign,
  getLeadList,
  hourInTimezone,
  leadBreakdown,
  leadCauseBreakdown,
  leadCountFor,
  leadTimezoneBreakdown,
  listCampaigns,
  localTimeInTimezone,
  pageLeadsFiltered,
} from '@dialeros/control-plane';
import { InlineCardForm } from '@/components/inline-card-form';
import { UploadCsvForm } from './upload-form';
import { DeleteLeadListButton } from './delete-button';
import { MoveListPicker } from './move-picker';
import { ResetStatusButton } from './reset-button';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

// Iter 95 — kept in sync with reset-button.tsx's RESETTABLE set so
// the inline Reset link only shows where it actually does
// something. NEW + DNC excluded by design.
const RESETTABLE_STATUSES = new Set([
  'CALLED_NO_ANSWER',
  'BUSY',
  'CALLBACK_SCHEDULED',
  'CONVERTED',
  'DNC_TEMP',
  'BAD_NUMBER',
  'DIALING',
  // Iter 107 — VM_PLAYED / SURVEYED carry positive signal; the
  // operator typically wants to re-engage them on a different
  // cadence rather than treating them as terminal.
  'VM_PLAYED',
  'SURVEYED',
]);

// Iter 80 — map FS hangup causes onto SIP response codes for the
// breakdown panel. ViciDial operators are used to reading SIP
// codes; the table is auto-extended with the raw cause when no
// mapping exists.
const CAUSE_TO_SIP: Record<string, { code: number; label: string }> = {
  NORMAL_CLEARING: { code: 200, label: 'Answered / completed' },
  USER_BUSY: { code: 486, label: 'Busy' },
  CALL_REJECTED: { code: 603, label: 'Rejected' },
  NO_ANSWER: { code: 480, label: 'No answer' },
  NO_USER_RESPONSE: { code: 408, label: 'No response (timeout)' },
  ALLOTTED_TIMEOUT: { code: 408, label: 'Timeout' },
  UNALLOCATED_NUMBER: { code: 404, label: 'Bad number' },
  INVALID_NUMBER_FORMAT: { code: 484, label: 'Invalid number format' },
  NO_ROUTE_DESTINATION: { code: 404, label: 'No route' },
  DESTINATION_OUT_OF_ORDER: { code: 503, label: 'Destination unreachable' },
  RECOVERY_ON_TIMER_EXPIRE: { code: 408, label: 'Timer expired' },
  NORMAL_TEMPORARY_FAILURE: { code: 503, label: 'Temporary failure' },
  ORIGINATOR_CANCEL: { code: 487, label: 'Cancelled by us' },
  IN_FLIGHT: { code: 0, label: 'Still in flight (no hangup yet)' },
};

function sipFor(cause: string): { code: number; label: string } {
  return CAUSE_TO_SIP[cause] ?? { code: 0, label: cause };
}

// Iter 80 — color the status pill so the operator can read a
// screenful of rows fast. NEW = neutral, the in-progress states
// blue, the failure states warn/error, success green.
const STATUS_TONE: Record<string, string> = {
  NEW: 'text-fg-muted',
  DIALING: 'text-info',
  CALLED_NO_ANSWER: 'text-warn',
  CALLBACK_SCHEDULED: 'text-info',
  CONVERTED: 'text-success',
  DNC: 'text-error',
  DNC_TEMP: 'text-warn',
  BAD_NUMBER: 'text-error',
  VM_PLAYED: 'text-info',
  SURVEYED: 'text-success',
};

function statusTone(status: string): string {
  return STATUS_TONE[status] ?? 'text-fg-muted';
}

export default async function LeadListDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    page?: string;
    status?: string;
    q?: string;
  }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const list = getLeadList(id);
  if (!list) notFound();

  const total = leadCountFor(id);
  const breakdown = leadBreakdown(id);
  const causeBreakdown = leadCauseBreakdown(id);
  const tzBreakdown = leadTimezoneBreakdown(id);

  // Filter state from query string.
  const status = sp.status?.trim() || null;
  const q = sp.q?.trim() || null;
  const page = Math.max(1, Number(sp.page ?? 1));
  const hasFilter = !!(status || q);

  // Only run the (paginated) lead query when a filter is in play.
  // The point of the iter is "don't show the full list by default".
  const { rows: leads, total: filteredTotal } = hasFilter
    ? pageLeadsFiltered(id, {
        status,
        search: q,
        page,
        pageSize: PAGE_SIZE,
      })
    : { rows: [], total: 0 };
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  const ownerCampaign = list.campaign_id
    ? getCampaign(list.campaign_id)
    : null;
  const allCampaigns = listCampaigns();

  // Campaign-window aware "dialable now?" per timezone.
  const winStart = ownerCampaign?.call_window_start ?? null;
  const winEnd = ownerCampaign?.call_window_end ?? null;
  function isInWindow(tz: string): boolean {
    if (!winStart || !winEnd) return true;
    const h = hourInTimezone(tz);
    const [sh] = winStart.split(':').map(Number) as [number, number];
    const [eh] = winEnd.split(':').map(Number) as [number, number];
    if (sh <= eh) return h >= sh && h < eh;
    return h >= sh || h < eh;
  }

  function buildHref(patch: {
    status?: string | null;
    q?: string | null;
    page?: number | null;
  }): string {
    const params = new URLSearchParams();
    const nextStatus =
      patch.status !== undefined ? patch.status : status;
    const nextQ = patch.q !== undefined ? patch.q : q;
    const nextPage =
      patch.page !== undefined ? patch.page : null;
    if (nextStatus) params.set('status', nextStatus);
    if (nextQ) params.set('q', nextQ);
    if (nextPage && nextPage > 1) params.set('page', String(nextPage));
    const qs = params.toString();
    return qs ? `/leads/${id}?${qs}` : `/leads/${id}`;
  }

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
      <p className="text-fg-subtle text-xs mb-6">
        {total.toLocaleString()} leads · created{' '}
        {new Date(list.created_at).toLocaleString()}
      </p>

      <div className="max-w-4xl mb-6">
        <InlineCardForm
          title="List details"
          endpoint={`/api/lead-lists/${list.id}`}
          fields={[
            {
              type: 'text',
              name: 'name',
              label: 'Name',
              value: list.name,
              maxLength: 64,
              hint: 'Alphanumeric, dashes, underscores only.',
            },
            {
              type: 'textarea',
              name: 'description',
              label: 'Description',
              value: list.description,
              maxLength: 500,
              placeholder:
                'Optional notes — what this list is for, source, etc.',
            },
          ]}
        />
      </div>

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
            <span className="text-fg-subtle normal-case tracking-normal ml-2">
              — click a count to drill in
            </span>
          </h2>
          {breakdown.length === 0 ? (
            <p className="text-fg-subtle text-sm">No leads yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {breakdown.map((b) => {
                const active = status === b.status;
                // Iter 95 — inline Reset button next to retriable
                // statuses so the operator doesn't have to drill
                // into the filtered view first.
                const resettable = RESETTABLE_STATUSES.has(b.status);
                return (
                  <li
                    key={b.status}
                    className="flex justify-between items-center gap-2"
                  >
                    <Link
                      href={buildHref({ status: b.status, page: 1 })}
                      className={`flex justify-between items-center px-2 py-1 rounded flex-1 ${
                        active
                          ? 'bg-accent/15 text-accent'
                          : 'hover:bg-card-hover'
                      }`}
                    >
                      <span
                        className={`font-mono text-xs ${statusTone(b.status)}`}
                      >
                        {b.status}
                      </span>
                      <span className="tabular-nums text-fg">
                        {b.count.toLocaleString()}
                      </span>
                    </Link>
                    {resettable && (
                      <ResetStatusButton
                        listId={id}
                        status={b.status}
                        matchedCount={b.count}
                        compact
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border border-border rounded p-4">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
            Last-call outcome (SIP)
            <span className="text-fg-subtle normal-case tracking-normal ml-2">
              — only leads we&apos;ve dialed
            </span>
          </h2>
          {causeBreakdown.length === 0 ? (
            <p className="text-fg-subtle text-sm">
              No live calls have landed yet. Cause counts show up after
              the campaign starts dialing this list.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {causeBreakdown.map((b) => {
                const sip = sipFor(b.cause);
                return (
                  <li
                    key={b.cause}
                    className="flex justify-between items-center px-2 py-1 rounded hover:bg-card-hover/60"
                    title={b.cause}
                  >
                    <span className="flex items-center gap-2">
                      {sip.code > 0 && (
                        <span className="font-mono text-xs text-fg-muted w-10 tabular-nums text-right">
                          {sip.code}
                        </span>
                      )}
                      <span className="text-xs text-fg">{sip.label}</span>
                      <span className="text-[10px] text-fg-subtle/70 font-mono">
                        {b.cause}
                      </span>
                    </span>
                    <span className="tabular-nums text-fg">
                      {b.count.toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="border border-border rounded p-4 max-w-4xl mb-6">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Upload CSV
        </h2>
        <UploadCsvForm listId={id} />
      </div>

      <div className="border border-border rounded p-4 max-w-4xl mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted">
            Timezone availability
          </h2>
          {winStart && winEnd ? (
            <span className="text-[11px] text-fg-subtle">
              Campaign call window {winStart}–{winEnd} (local)
            </span>
          ) : (
            <span className="text-[11px] text-fg-subtle">
              No campaign call window — all hours dialable
            </span>
          )}
        </div>
        {tzBreakdown.length === 0 ? (
          <p className="text-fg-subtle text-sm">No leads yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-1.5 font-medium">Timezone</th>
                <th className="font-medium tabular-nums">Leads</th>
                <th className="font-medium tabular-nums">Local time</th>
                <th className="font-medium">Dialable now</th>
              </tr>
            </thead>
            <tbody>
              {tzBreakdown.map((row) => {
                const known = row.tz !== '—';
                const localTime = known ? localTimeInTimezone(row.tz) : '—';
                const dialable = known ? isInWindow(row.tz) : false;
                return (
                  <tr key={row.tz} className="border-b border-border/40">
                    <td className="py-2 font-mono text-xs text-fg">
                      {known ? (
                        row.tz
                      ) : (
                        <span className="text-fg-subtle">unknown</span>
                      )}
                    </td>
                    <td className="tabular-nums text-fg">
                      {row.count.toLocaleString()}
                    </td>
                    <td className="tabular-nums text-fg-muted">
                      {localTime}
                    </td>
                    <td>
                      {known ? (
                        dialable ? (
                          <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
                            DIALABLE
                          </span>
                        ) : (
                          <span className="bg-warn/15 text-warn border border-warn/40 px-2 py-0.5 rounded text-xs">
                            OUTSIDE WINDOW
                          </span>
                        )
                      ) : (
                        <span className="text-fg-subtle text-xs">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="border border-border rounded p-4 max-w-5xl mb-6">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Find a lead
        </h2>
        <form method="GET" className="flex items-end gap-3 mb-3">
          <label className="flex-1">
            <div className="text-xs text-fg-subtle mb-1">
              Phone, name, or email substring
            </div>
            <input
              name="q"
              defaultValue={q ?? ''}
              placeholder="e.g. 415555 or john@"
              className="input text-sm w-full"
              autoComplete="off"
            />
          </label>
          {status && <input type="hidden" name="status" value={status} />}
          <button
            type="submit"
            className="bg-accent hover:bg-accent-hover text-accent-fg px-3 py-1.5 rounded text-sm"
          >
            Search
          </button>
          {hasFilter && (
            <Link
              href={`/leads/${id}`}
              className="text-xs px-3 py-1.5 rounded border border-border text-fg-muted hover:text-fg"
            >
              Clear filters
            </Link>
          )}
        </form>

        {!hasFilter ? (
          <p className="text-fg-subtle text-sm">
            Pick a status / SIP outcome above, or search by phone / name /
            email, to view leads. The full list isn&apos;t shown by default
            so the page stays fast on large lists.
          </p>
        ) : leads.length === 0 ? (
          <p className="text-fg-subtle text-sm">
            No leads match{' '}
            {status && (
              <span className="font-mono text-xs">status={status}</span>
            )}
            {status && q && ' · '}
            {q && <span className="font-mono text-xs">q={q}</span>}.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium">
                Showing {(page - 1) * PAGE_SIZE + 1}–
                {Math.min(page * PAGE_SIZE, filteredTotal)} of{' '}
                {filteredTotal.toLocaleString()}
                {status && (
                  <span className="text-fg-subtle font-normal ml-2 text-xs">
                    · status ={' '}
                    <span className="font-mono">{status}</span>
                  </span>
                )}
                {q && (
                  <span className="text-fg-subtle font-normal ml-2 text-xs">
                    · q = <span className="font-mono">{q}</span>
                  </span>
                )}
              </h3>
              <div className="flex gap-2 text-xs items-center">
                {/* Iter 94 — bulk-reset action when the status
                    filter is on. Pacer only dials statuses in the
                    campaign's dialable_statuses set, so resetting
                    a stuck status (e.g. CALLED_NO_ANSWER) back to
                    NEW gets those leads back into the rotation
                    even if NEW is the only allowed status. */}
                {status && (
                  <ResetStatusButton
                    listId={id}
                    status={status}
                    matchedCount={filteredTotal}
                  />
                )}
                {page > 1 && (
                  <Link
                    href={buildHref({ page: page - 1 })}
                    className="px-2 py-1 border border-border rounded hover:bg-card-hover"
                  >
                    ← prev
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    href={buildHref({ page: page + 1 })}
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
                  <th className="font-medium">Last called</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} className="border-b border-border/50">
                    <td className="py-2 font-mono text-fg">
                      <Link
                        href={`/leads/lead/${lead.id}`}
                        className="hover:underline"
                      >
                        {lead.phone}
                      </Link>
                    </td>
                    <td className="text-fg-muted">{lead.name ?? '—'}</td>
                    <td className="text-fg-muted">{lead.email ?? '—'}</td>
                    <td>
                      <span
                        className={`font-mono text-xs ${statusTone(lead.status)}`}
                      >
                        {lead.status}
                      </span>
                    </td>
                    <td className="text-fg-subtle text-xs">
                      {lead.last_called_at
                        ? new Date(lead.last_called_at).toLocaleString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="mt-8 max-w-5xl">
        <DeleteLeadListButton id={list.id} name={list.name} count={total} />
      </div>
    </div>
  );
}
