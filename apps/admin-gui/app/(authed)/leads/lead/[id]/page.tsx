import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import {
  getLead,
  getLeadList,
  leadCallHistory,
} from '@dialeros/control-plane';
import { InlineCardForm } from '@/components/inline-card-form';
import { DeleteLeadButton } from './delete-button';
import { PlayRecording } from './play-recording';

export const dynamic = 'force-dynamic';

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

// Iter 92 — same SIP-code map the list page uses. Kept inline so
// this page doesn't depend on the list page's module.
const CAUSE_TO_SIP: Record<string, { code: number; label: string }> = {
  NORMAL_CLEARING: { code: 200, label: 'Answered / completed' },
  USER_BUSY: { code: 486, label: 'Busy' },
  CALL_REJECTED: { code: 603, label: 'Rejected' },
  NO_ANSWER: { code: 480, label: 'No answer' },
  NO_USER_RESPONSE: { code: 408, label: 'No response' },
  ALLOTTED_TIMEOUT: { code: 408, label: 'Timeout' },
  UNALLOCATED_NUMBER: { code: 404, label: 'Bad number' },
  INVALID_NUMBER_FORMAT: { code: 484, label: 'Invalid format' },
  NO_ROUTE_DESTINATION: { code: 404, label: 'No route' },
  DESTINATION_OUT_OF_ORDER: { code: 503, label: 'Destination down' },
  RECOVERY_ON_TIMER_EXPIRE: { code: 408, label: 'Timer expired' },
  NORMAL_TEMPORARY_FAILURE: { code: 503, label: 'Temporary failure' },
  ORIGINATOR_CANCEL: { code: 487, label: 'Cancelled' },
};

function formatDuration(ms: number | null): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return r === 0 ? `${m}m` : `${m}m${r}s`;
}

export default async function LeadDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = getLead(id);
  if (!lead) notFound();
  const list = getLeadList(lead.list_id);
  const history = leadCallHistory(lead.id, 50);

  const customFields = (() => {
    try {
      return JSON.parse(lead.custom_fields_json) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();

  return (
    <div>
      <div className="mb-1">
        {list ? (
          <Link
            href={`/leads/${list.id}`}
            className="text-xs text-fg-subtle hover:text-fg-muted"
          >
            ← {list.name}
          </Link>
        ) : (
          <Link
            href="/leads"
            className="text-xs text-fg-subtle hover:text-fg-muted"
          >
            ← Lead Lists
          </Link>
        )}
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold font-mono">{lead.phone}</h1>
        <span
          className={`font-mono text-xs uppercase ${
            STATUS_TONE[lead.status] ?? 'text-fg-muted'
          }`}
        >
          {lead.status}
        </span>
      </div>
      <p className="text-fg-subtle text-xs mb-6">
        {lead.timezone ?? 'unknown timezone'} · created{' '}
        {new Date(lead.created_at).toLocaleString()}
        {lead.last_called_at && (
          <>
            {' · last called '}
            {new Date(lead.last_called_at).toLocaleString()}
          </>
        )}
      </p>

      <div className="max-w-4xl mb-6">
        <InlineCardForm
          title="Lead"
          endpoint={`/api/leads/${lead.id}`}
          layout="rows"
          fields={[
            {
              type: 'text',
              name: 'name',
              label: 'Name',
              value: lead.name,
              maxLength: 120,
              hint: 'Optional display name.',
            },
            {
              type: 'text',
              name: 'email',
              label: 'Email',
              value: lead.email,
              maxLength: 120,
            },
            {
              type: 'select',
              name: 'status',
              label: 'Status',
              value: lead.status,
              options: [
                { value: 'NEW', label: 'NEW' },
                { value: 'CALLED_NO_ANSWER', label: 'CALLED_NO_ANSWER' },
                { value: 'BUSY', label: 'BUSY' },
                { value: 'CALLBACK_SCHEDULED', label: 'CALLBACK_SCHEDULED' },
                { value: 'CONVERTED', label: 'CONVERTED' },
                { value: 'VM_PLAYED', label: 'VM_PLAYED' },
                { value: 'SURVEYED', label: 'SURVEYED' },
                { value: 'DNC', label: 'DNC' },
                { value: 'DNC_TEMP', label: 'DNC_TEMP' },
                { value: 'BAD_NUMBER', label: 'BAD_NUMBER' },
              ],
              hint: 'Manual override. The pacer also writes this column automatically as calls go through.',
            },
            {
              type: 'text',
              name: 'timezone',
              label: 'Timezone',
              value: lead.timezone,
              maxLength: 64,
              hint: 'IANA TZ identifier like America/New_York. Inferred from phone area code at ingest; override here if the inference is wrong.',
            },
            {
              type: 'text',
              name: 'preferred_cid',
              label: 'Preferred caller ID',
              value: lead.preferred_cid,
              maxLength: 40,
              hint: 'Iter 125 — when set, the pacer + manual dial use this caller-ID for this lead instead of the route plan strategy. Useful for stickiness with a number the prospect already recognises. Leave blank to fall back to the route plan.',
            },
          ]}
          helpText="Phone is intentionally locked — it's the key for DNC matching + call-history correlation. To change a phone, delete this lead and add a new one."
        />
      </div>

      {Object.keys(customFields).length > 0 && (
        <div className="border border-border rounded p-4 max-w-4xl mb-6">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
            Custom fields
          </h2>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            {Object.entries(customFields).map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-fg-subtle font-mono text-xs">{k}</dt>
                <dd className="text-fg break-all">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="border border-border rounded p-4 max-w-5xl mb-6">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Call history ({history.length})
        </h2>
        {history.length === 0 ? (
          <p className="text-fg-subtle text-sm">
            No real calls placed to this lead yet (simulated rows are
            excluded).
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-fg-subtle border-b border-border">
              <tr>
                <th className="py-2 font-medium">When</th>
                <th className="font-medium">Campaign</th>
                <th className="font-medium">Carrier</th>
                <th className="font-medium">CID used</th>
                <th className="font-medium">Outcome</th>
                <th className="font-medium text-right">Duration</th>
                <th className="font-medium">Recording</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => {
                const sip = h.hangup_cause
                  ? (CAUSE_TO_SIP[h.hangup_cause] ?? {
                      code: 0,
                      label: h.hangup_cause,
                    })
                  : null;
                let outcomeLabel: string;
                let outcomeTone: string;
                if (h.originate_error) {
                  outcomeLabel = `REJECTED`;
                  outcomeTone = 'text-error';
                } else if (!h.hangup_at) {
                  outcomeLabel = h.answered_at
                    ? 'CONNECTED'
                    : 'DIALING';
                  outcomeTone = h.answered_at
                    ? 'text-success'
                    : 'text-info';
                } else if (
                  h.hangup_cause === 'NORMAL_CLEARING' &&
                  h.answered_at
                ) {
                  outcomeLabel = 'COMPLETED';
                  outcomeTone = 'text-success';
                } else {
                  outcomeLabel = sip?.label ?? h.hangup_cause ?? 'UNKNOWN';
                  outcomeTone =
                    sip?.code === 486
                      ? 'text-warn'
                      : 'text-fg-muted';
                }
                return (
                  <Fragment key={h.id}>
                  <tr className="border-b border-border/40">
                    <td className="py-2 text-fg-subtle text-xs whitespace-nowrap">
                      {new Date(h.ts).toLocaleString()}
                    </td>
                    <td>
                      <Link
                        href={`/campaigns/${h.campaign_id}`}
                        className="hover:underline"
                      >
                        {h.campaign_name}
                      </Link>
                    </td>
                    <td className="text-fg-muted">
                      {h.carrier_id && h.carrier_name ? (
                        <Link
                          href={`/carriers/${h.carrier_id}`}
                          className="hover:underline"
                        >
                          {h.carrier_name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="font-mono text-xs">
                      {h.cid_used ?? '—'}
                    </td>
                    <td className={`text-xs ${outcomeTone}`}>
                      {outcomeLabel}
                      {h.hangup_cause && sip && sip.code > 0 && (
                        <span className="text-fg-subtle ml-2">
                          {sip.code} · {h.hangup_cause}
                        </span>
                      )}
                      {h.originate_error && (
                        <span className="text-fg-subtle ml-2 break-all">
                          {h.originate_error}
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums text-fg-muted">
                      {formatDuration(h.duration_ms)}
                    </td>
                    <td>
                      <PlayRecording
                        intentId={h.id}
                        available={Boolean(h.recording_path)}
                      />
                    </td>
                  </tr>
                  {(h.ai_summary || h.transcript_text || h.ai_sentiment || h.ai_flags) && (
                    <tr className="border-b border-border/40">
                      <td colSpan={7} className="py-2 px-3 bg-card-hover/20">
                        {(h.ai_sentiment || h.ai_flags) && (
                          <div className="flex items-center gap-2 flex-wrap mb-2 text-[10px] uppercase tracking-wide">
                            {h.ai_sentiment && (
                              <span
                                className={`px-2 py-0.5 rounded border border-border ${
                                  h.ai_sentiment === 'positive'
                                    ? 'text-success'
                                    : h.ai_sentiment === 'negative'
                                      ? 'text-error'
                                      : h.ai_sentiment === 'mixed'
                                        ? 'text-warn'
                                        : 'text-fg-muted'
                                }`}
                                title="LLM sentiment classification"
                              >
                                {h.ai_sentiment}
                              </span>
                            )}
                            {(() => {
                              if (!h.ai_flags) return null;
                              let flags: string[] = [];
                              try {
                                const arr = JSON.parse(h.ai_flags);
                                if (Array.isArray(arr)) flags = arr as string[];
                              } catch {
                                /* ignore */
                              }
                              return flags.map((f) => {
                                const tone =
                                  f === 'DNC_REQUESTED' || f === 'HOSTILE'
                                    ? 'text-error'
                                    : f === 'WRONG_NUMBER' || f === 'RECORDING_OBJECTION'
                                      ? 'text-warn'
                                      : f === 'SALE_CONFIRMED'
                                        ? 'text-success'
                                        : 'text-info';
                                return (
                                  <span
                                    key={f}
                                    className={`px-2 py-0.5 rounded border border-border ${tone}`}
                                  >
                                    {f.replace(/_/g, ' ')}
                                  </span>
                                );
                              });
                            })()}
                          </div>
                        )}
                        <div className="text-[10px] uppercase tracking-wide text-fg-subtle mb-1">
                          AI summary
                        </div>
                        {h.ai_summary ? (
                          <p className="text-sm text-fg whitespace-pre-wrap">
                            {h.ai_summary}
                          </p>
                        ) : (
                          <p className="text-xs text-fg-subtle italic">
                            (Summary not produced — transcript only)
                          </p>
                        )}
                        {h.transcript_text && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-fg-subtle hover:text-fg-muted">
                              Transcript ({h.transcript_text.length.toLocaleString()} chars)
                            </summary>
                            <p className="text-xs text-fg-muted whitespace-pre-wrap mt-1 max-h-64 overflow-y-auto">
                              {h.transcript_text}
                            </p>
                          </details>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs max-w-4xl mb-6">
        <div>
          <dt className="text-fg-subtle uppercase">ID</dt>
          <dd className="font-mono mt-0.5">{lead.id}</dd>
        </div>
        <div>
          <dt className="text-fg-subtle uppercase">List</dt>
          <dd className="mt-0.5">
            {list ? (
              <Link
                href={`/leads/${list.id}`}
                className="hover:underline"
              >
                {list.name}
              </Link>
            ) : (
              <span className="text-fg-subtle">—</span>
            )}
          </dd>
        </div>
      </dl>

      <DeleteLeadButton
        leadId={lead.id}
        phone={lead.phone}
        backHref={list ? `/leads/${list.id}` : '/leads'}
      />
    </div>
  );
}
