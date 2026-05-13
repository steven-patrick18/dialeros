import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getCallDetail } from '@dialeros/control-plane';
import { CallActionsCard } from './actions-card';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

// Iter 143 — Call detail page. One screen with everything we know
// about a single dial_intent: parties, timeline, AMD verdict,
// recording (full-width audio + download), AI transcript + summary
// + sentiment + flags, plus the raw correlation/call uuids for
// support cases.
//
// Authz:
//   admin       — any call
//   supervisor  — any call
//   agent       — only calls assigned to them (same rule as the
//                 /api/recordings/[id] stream)
//   other       — no access

const SENTIMENT_TONE: Record<string, string> = {
  positive: 'text-success',
  neutral: 'text-fg-muted',
  negative: 'text-error',
  mixed: 'text-warn',
};

const FLAG_TONE: Record<string, string> = {
  DNC_REQUESTED: 'text-error',
  HOSTILE: 'text-error',
  WRONG_NUMBER: 'text-warn',
  RECORDING_OBJECTION: 'text-warn',
  CALLBACK_PROMISED: 'text-info',
  SALE_CONFIRMED: 'text-success',
  VOICEMAIL_DROPPED: 'text-info',
};

const AMD_TONE: Record<string, string> = {
  HUMAN: 'text-success',
  MACHINE: 'text-warn',
  NOTSURE: 'text-fg-muted',
  UNKNOWN: 'text-fg-muted',
};

function fmtTs(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r.toString().padStart(2, '0')}s`;
}

function parseFlags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export default async function CallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');

  const { id } = await params;
  const intentId = Number(id);
  if (!Number.isInteger(intentId) || intentId <= 0) notFound();
  const call = getCallDetail(intentId);
  if (!call) notFound();

  // Authz — admin/supervisor any; agent only if assigned.
  const isPrivileged = me.role === 'admin' || me.role === 'supervisor';
  if (!isPrivileged && call.assigned_user_id !== me.id) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Call detail</h1>
        <p className="text-error text-sm">
          You can only view calls assigned to you.
        </p>
      </div>
    );
  }

  const flags = parseFlags(call.ai_flags);
  const wasAnswered = Boolean(call.answered_at);
  const wasOriginated = call.kind === 'originated' || wasAnswered;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <div className="text-xs text-fg-subtle mb-1">
          <Link
            href="/supervisor/calls"
            className="text-link hover:underline"
          >
            ← back to floor calls
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">Call #{call.id}</h1>
        <div className="text-sm text-fg-muted mt-1">
          {fmtTs(call.ts)}
          {call.campaign_name ? ` · ${call.campaign_name}` : ''}
          {call.assigned_username
            ? ` · ${call.assigned_display_name ?? call.assigned_username}`
            : ' · no agent assigned'}
        </div>
      </div>

      {/* Parties + IDs */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-border rounded p-4 bg-card">
          <h2 className="text-xs uppercase tracking-wide text-fg-subtle mb-3">
            Lead
          </h2>
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-fg-subtle">Phone: </span>
              <Link
                href={`/leads/lead/${call.lead_id}`}
                className="font-mono text-link hover:underline"
              >
                {call.lead_phone}
              </Link>
            </div>
            <div>
              <span className="text-fg-subtle">Dialed: </span>
              <span className="font-mono">{call.transformed_phone}</span>
            </div>
            {call.lead_name ? (
              <div>
                <span className="text-fg-subtle">Name: </span>
                {call.lead_name}
              </div>
            ) : null}
          </div>
        </div>
        <div className="border border-border rounded p-4 bg-card">
          <h2 className="text-xs uppercase tracking-wide text-fg-subtle mb-3">
            Routing
          </h2>
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-fg-subtle">Route plan: </span>
              {call.route_plan_name ?? call.route_plan_id ?? '—'}
            </div>
            <div>
              <span className="text-fg-subtle">Carrier: </span>
              {call.carrier_name ?? call.carrier_id ?? '—'}
            </div>
            <div>
              <span className="text-fg-subtle">Caller ID: </span>
              {call.cid_used ? (
                <span className="font-mono">{call.cid_used}</span>
              ) : (
                '—'
              )}
            </div>
            <div>
              <span className="text-fg-subtle">Kind: </span>
              {call.kind}
            </div>
          </div>
        </div>
      </section>

      {/* Iter 160 — per-call actions (admin / supervisor). */}
      <CallActionsCard
        callId={call.id}
        leadPhone={call.lead_phone}
        canAct={isPrivileged}
      />

      {/* Timeline */}
      <section className="border border-border rounded p-4 bg-card">
        <h2 className="text-xs uppercase tracking-wide text-fg-subtle mb-3">
          Timeline
        </h2>
        <div className="space-y-1 text-sm font-mono">
          <div>
            <span className="text-fg-subtle">queued </span>
            {fmtTs(call.ts)}
          </div>
          {call.originate_error ? (
            <div className="text-error">
              <span className="text-fg-subtle">originate error </span>
              {call.originate_error}
            </div>
          ) : null}
          {wasOriginated && !call.originate_error ? (
            <div>
              <span className="text-fg-subtle">originated </span>
              (kind: {call.kind})
            </div>
          ) : null}
          {call.answered_at ? (
            <div>
              <span className="text-fg-subtle">answered </span>
              {fmtTs(call.answered_at)}
            </div>
          ) : null}
          {call.dispositioned_at ? (
            <div>
              <span className="text-fg-subtle">dispositioned </span>
              {fmtTs(call.dispositioned_at)} ·{' '}
              <span className="text-fg">{call.disposition ?? '—'}</span>
              {call.disposition_origin === 'auto' ? (
                <span className="ml-1 text-xs text-fg-subtle">(auto)</span>
              ) : call.disposition_origin === 'agent' ? (
                <span className="ml-1 text-xs text-fg-subtle">(agent)</span>
              ) : null}
            </div>
          ) : null}
          {call.hangup_at ? (
            <div>
              <span className="text-fg-subtle">hangup </span>
              {fmtTs(call.hangup_at)}
              {call.hangup_cause
                ? ` · cause: ${call.hangup_cause}`
                : ''}
            </div>
          ) : (
            <div className="text-warn">
              <span className="text-fg-subtle">hangup </span>
              not yet recorded
            </div>
          )}
          <div className="pt-2 border-t border-border mt-2 text-fg">
            <span className="text-fg-subtle">total duration </span>
            {fmtDuration(call.duration_ms)}
          </div>
        </div>
      </section>

      {/* AMD verdict */}
      {call.amd_result ? (
        <section className="border border-border rounded p-4 bg-card">
          <h2 className="text-xs uppercase tracking-wide text-fg-subtle mb-3">
            Answering-machine detect (amd_v2)
          </h2>
          <div className="text-sm">
            Verdict:{' '}
            <span
              className={`font-semibold ${
                AMD_TONE[call.amd_result] ?? 'text-fg'
              }`}
            >
              {call.amd_result}
            </span>
          </div>
        </section>
      ) : null}

      {/* Recording */}
      <section className="border border-border rounded p-4 bg-card">
        <h2 className="text-xs uppercase tracking-wide text-fg-subtle mb-3">
          Recording
        </h2>
        {call.recording_path ? (
          <div className="space-y-2">
            <audio
              controls
              src={`/api/recordings/${call.id}`}
              className="w-full"
            />
            <div className="flex items-center gap-3 text-sm">
              <a
                href={`/api/recordings/${call.id}?download=1`}
                className="text-link hover:underline"
              >
                Download .wav
              </a>
              <span className="text-fg-subtle text-xs font-mono">
                {call.recording_path}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-fg-subtle">
            No recording on disk for this call.
          </p>
        )}
      </section>

      {/* AI */}
      <section className="border border-border rounded p-4 bg-card">
        <h2 className="text-xs uppercase tracking-wide text-fg-subtle mb-3">
          AI analysis
        </h2>
        {call.ai_processed_at ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide">
              {call.ai_sentiment ? (
                <span
                  className={`px-2 py-0.5 rounded border border-border ${
                    SENTIMENT_TONE[call.ai_sentiment] ?? 'text-fg-muted'
                  }`}
                >
                  {call.ai_sentiment}
                </span>
              ) : null}
              {flags.map((f) => (
                <span
                  key={f}
                  className={`px-2 py-0.5 rounded border border-border ${
                    FLAG_TONE[f] ?? 'text-fg-muted'
                  }`}
                >
                  {f.replace(/_/g, ' ')}
                </span>
              ))}
              <span className="text-fg-subtle normal-case tracking-normal">
                processed {fmtTs(call.ai_processed_at)}
              </span>
            </div>
            {call.ai_summary ? (
              <div>
                <h3 className="text-xs uppercase tracking-wide text-fg-subtle mb-1">
                  Summary
                </h3>
                <p className="text-sm leading-snug">{call.ai_summary}</p>
              </div>
            ) : null}
            {call.transcript_text ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-fg-subtle hover:text-fg">
                  Full transcript ({call.transcript_text.length} chars)
                </summary>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-snug bg-bg-elevated p-3 rounded border border-border">
                  {call.transcript_text}
                </pre>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-fg-subtle">
            {call.recording_path
              ? 'Pending — the AI worker hasn’t processed this row yet.'
              : 'Nothing to process (no recording).'}
          </p>
        )}
      </section>

      {/* Raw IDs — useful for support when correlating with FS logs. */}
      <section className="text-xs font-mono text-fg-subtle space-y-1">
        <div>correlation_id: {call.correlation_id ?? '—'}</div>
        <div>call_uuid: {call.call_uuid ?? '—'}</div>
      </section>
    </div>
  );
}
