import Link from 'next/link';
import {
  agentTodayScoreboard,
  getPrimaryPhone,
  getUserCampaignIds,
  getUserInGroupIds,
  listAuditEventsFiltered,
  listDialIntentsForUser,
  pauseReasonAnalytics,
  type AgentTodayScoreboard,
  type AuditEventRecord,
  type PauseReasonRow,
  type UserRecord,
} from '@dialeros/control-plane';

// Iter 129 — supervisor-facing activity + diagnostics for any
// user. Single-shot read at request time; refresh = reload. Three
// sections:
//
//   1. Today scoreboard — same shape as iter 98's /agent header.
//      Re-uses agentTodayScoreboard so the numbers can't drift
//      between the user's own console + the supervisor view.
//
//   2. Diagnostics — quick "is this user set up correctly?"
//      checks. Catches the common misconfigurations that surface
//      as "calls aren't reaching me" support tickets:
//        - no primary phone provisioned (REGISTER target missing)
//        - primary phone not pinned to a telephony node
//        - agent role with zero campaign/in-group attachments
//      Each issue has an explicit ✕ red marker; clean rows are
//      checkmarked ✓ green so the supervisor sees "all good"
//      at a glance.
//
//   3. Recent activity — last 30 dial intents (with disposition)
//      + last 30 audit events where this user was the actor.
//      Two side-by-side tables. Bug hunting use case: "what was
//      this agent doing right before they got logged out?"
//
// Pulls the iter-85 null-prototype dance via JSON roundtrip is
// NOT needed because this is a server component rendering server
// JSX directly — no RSC client-bridge.

export function UserActivityPanel({ user }: { user: UserRecord }) {
  const score = agentTodayScoreboard(user.id);
  const primary = getPrimaryPhone(user.id);
  const campaignIds = getUserCampaignIds(user.id);
  const inGroupIds = getUserInGroupIds(user.id);
  const intents = listDialIntentsForUser(user.id, 30);
  const audits = listAuditEventsFiltered({
    actorUserId: user.id,
    limit: 30,
  });
  // Iter 130 — last-7d pause patterns scoped to this user. A
  // wider window than /reports' 24h slice because per-user
  // patterns emerge over a week, not a shift.
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const userPauses = pauseReasonAnalytics(since7d, user.id);

  const isAgent = user.role === 'agent';
  const diagnostics = [
    {
      ok: !!primary,
      label: 'Primary phone provisioned',
      detail: primary
        ? `ext ${primary.extension}`
        : 'No phone — REGISTER will fail and pacer has no bridge target.',
    },
    {
      ok: !primary || !!primary.telephony_node_id,
      label: 'Primary phone pinned to a telephony node',
      detail:
        !primary
          ? 'N/A — no primary phone yet.'
          : primary.telephony_node_id
            ? `node ${primary.telephony_node_id.slice(0, 12)}…`
            : 'Phone has no telephony_node — fine on single-box deploys, ambiguous in a cluster.',
      severity: 'warn' as const,
    },
    {
      ok: !isAgent || campaignIds.length > 0 || inGroupIds.length > 0,
      label: 'Has at least one campaign or in-group attachment',
      detail: isAgent
        ? `${campaignIds.length} campaign(s), ${inGroupIds.length} in-group(s)`
        : `${user.role} — bypasses attachment requirement`,
    },
    {
      ok: user.is_active === 1,
      label: 'Account is active',
      detail:
        user.is_active === 1
          ? 'is_active = 1'
          : 'INACTIVE — agent can\'t sign in; supervisor view only.',
    },
  ];

  return (
    <div className="space-y-6 mb-6">
      {/* Today scoreboard */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Today
        </h2>
        <Scoreboard score={score} />
      </section>

      {/* Diagnostics */}
      <section>
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
          Diagnostics
        </h2>
        <ul className="border border-border rounded divide-y divide-border max-w-3xl">
          {diagnostics.map((d) => (
            <li
              key={d.label}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                {d.ok ? (
                  <span className="text-success">✓</span>
                ) : (
                  <span
                    className={
                      d.severity === 'warn' ? 'text-warn' : 'text-error'
                    }
                  >
                    ✕
                  </span>
                )}
                <span
                  className={d.ok ? 'text-fg' : 'text-fg-muted'}
                >
                  {d.label}
                </span>
              </span>
              <span className="text-fg-subtle text-xs font-mono truncate ml-3">
                {d.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* Iter 130 — per-user pause patterns over the last 7 days.
          Surfaces "this agent spent 4h on Coaching this week"
          which would be invisible in the floor-wide /reports view.
          Hidden when nothing to report — keeps the card list
          tight for new accounts. */}
      {userPauses.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
            Pause patterns — last 7 days
          </h2>
          <div className="border border-border rounded overflow-hidden max-w-3xl">
            <table className="w-full text-sm">
              <thead className="text-left text-fg-subtle border-b border-border bg-card-hover/30">
                <tr>
                  <th className="py-1.5 px-3 font-medium">Reason</th>
                  <th className="font-medium tabular-nums text-right">
                    Pauses
                  </th>
                  <th className="font-medium tabular-nums text-right">
                    Avg
                  </th>
                  <th className="font-medium tabular-nums text-right px-3">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {userPauses.map((p) => (
                  <tr key={p.reason} className="border-b border-border/40">
                    <td className="py-1.5 px-3">
                      {p.reason}
                      {p.still_paused > 0 && (
                        <span className="text-warn text-[10px] uppercase tracking-wide ml-2">
                          on pause
                        </span>
                      )}
                    </td>
                    <td className="tabular-nums text-right">{p.count}</td>
                    <td className="tabular-nums text-right text-fg-muted">
                      {fmtPauseDuration(p.avg_duration_ms)}
                    </td>
                    <td className="tabular-nums text-right text-fg px-3">
                      {fmtPauseDuration(p.total_duration_ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Recent intents + audit, side by side on wide screens */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 max-w-6xl">
        <div className="border border-border rounded p-3">
          <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
            Recent calls ({intents.length})
          </h3>
          {intents.length === 0 ? (
            <p className="text-fg-subtle text-sm">No assigned calls yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-fg-subtle border-b border-border">
                <tr>
                  <th className="py-1 font-medium">When</th>
                  <th className="font-medium">Phone</th>
                  <th className="font-medium">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {[...intents].reverse().map((i) => (
                  <tr key={i.id} className="border-b border-border/40">
                    <td className="py-1 text-fg-subtle font-mono whitespace-nowrap">
                      {new Date(i.ts).toLocaleTimeString()}
                    </td>
                    <td className="font-mono">{i.transformed_phone}</td>
                    <td>
                      {i.disposition ? (
                        <span className="text-success text-[10px] uppercase tracking-wide">
                          ✓ {i.disposition}
                        </span>
                      ) : i.hangup_cause ? (
                        <span className="text-fg-muted text-[10px] uppercase tracking-wide">
                          {i.hangup_cause}
                        </span>
                      ) : i.answered_at ? (
                        <span className="text-info text-[10px] uppercase tracking-wide">
                          CONNECTED
                        </span>
                      ) : (
                        <span className="text-fg-subtle text-[10px] uppercase tracking-wide">
                          DIALING
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="border border-border rounded p-3">
          <h3 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
            Recent audit ({audits.length})
          </h3>
          {audits.length === 0 ? (
            <p className="text-fg-subtle text-sm">
              No audited actions by this user yet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-left text-fg-subtle border-b border-border">
                <tr>
                  <th className="py-1 font-medium">When</th>
                  <th className="font-medium">Action</th>
                  <th className="font-medium">Target</th>
                </tr>
              </thead>
              <tbody>
                {audits.map((a) => (
                  <AuditRow key={a.id} row={a} />
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-2 text-right">
            <Link
              href={`/audit?actor=${user.id}`}
              className="text-[10px] text-fg-subtle hover:text-fg-muted"
            >
              Full audit log →
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Scoreboard({ score }: { score: AgentTodayScoreboard }) {
  const talkMinutes = Math.floor(score.talk_time_ms_today / 60000);
  const talkSeconds = Math.floor(
    (score.talk_time_ms_today % 60000) / 1000,
  );
  const talkLabel =
    score.talk_time_ms_today === 0
      ? '—'
      : talkMinutes > 0
        ? `${talkMinutes}m${talkSeconds.toString().padStart(2, '0')}s`
        : `${talkSeconds}s`;
  const onCallTone = score.current_intent_id
    ? 'text-success'
    : 'text-fg-subtle';
  const statusTone =
    score.status === 'AVAILABLE'
      ? 'text-success'
      : score.status === 'PAUSED'
        ? 'text-warn'
        : 'text-fg';
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 max-w-4xl">
      <Stat
        label="On call"
        value={score.current_intent_id ? 'YES' : '—'}
        tone={onCallTone}
        hint={
          score.current_phone
            ? `${score.current_phone} since ${new Date(
                score.current_answered_at ?? '',
              ).toLocaleTimeString()}`
            : 'No bridged call right now'
        }
      />
      <Stat
        label="Status"
        value={score.status.replace('_', '-')}
        tone={statusTone}
        hint={score.pause_reason ?? undefined}
      />
      <Stat
        label="Calls"
        value={score.calls_today.toLocaleString()}
        tone={score.calls_today > 0 ? 'text-fg' : 'text-fg-subtle'}
      />
      <Stat
        label="Talked"
        value={score.talked_today.toLocaleString()}
        tone={score.talked_today > 0 ? 'text-success' : 'text-fg-subtle'}
      />
      <Stat
        label="Talk time"
        value={talkLabel}
        tone={
          score.talk_time_ms_today > 0 ? 'text-success' : 'text-fg-subtle'
        }
      />
      <Stat
        label="Dispositions"
        value={score.dispositions_today.toLocaleString()}
        tone={
          score.dispositions_today > 0 ? 'text-success' : 'text-fg-subtle'
        }
      />
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: string;
  hint?: string;
}) {
  return (
    <div
      title={hint}
      className={`border border-border rounded p-2 ${hint ? 'cursor-help' : ''}`}
    >
      <div className="text-[10px] uppercase tracking-wide text-fg-subtle">
        {label}
      </div>
      <div className={`text-lg mt-0.5 tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function fmtPauseDuration(ms: number): string {
  if (ms <= 0) return '—';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) {
    const s = sec % 60;
    return `${min}m${s.toString().padStart(2, '0')}s`;
  }
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h${m.toString().padStart(2, '0')}m`;
}

function AuditRow({ row }: { row: AuditEventRecord }) {
  const target =
    row.target_type && row.target_id
      ? `${row.target_type}/${row.target_id.slice(0, 8)}`
      : '—';
  return (
    <tr className="border-b border-border/40">
      <td className="py-1 text-fg-subtle font-mono whitespace-nowrap">
        {new Date(row.ts).toLocaleTimeString()}
      </td>
      <td className="font-mono text-fg-muted truncate max-w-[140px]">
        {row.action}
      </td>
      <td className="font-mono text-fg-subtle text-[10px] truncate">
        {target}
      </td>
    </tr>
  );
}
