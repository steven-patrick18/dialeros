import { redirect } from 'next/navigation';
import {
  agentTodayScoreboard,
  getAgentStatus,
  getInGroupsForAgent,
  listDialIntentsForUser,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { SoftphoneProvider } from '@/components/softphone';
import { AgentFeed } from './agent-feed';
import { AgentSoftphoneBadge } from './softphone-badge';
import { AgentSoftphonePanel } from './softphone-panel';
import { PauseControl } from './pause-control';
import { WrapUpOverlay } from './wrap-up-overlay';

export const dynamic = 'force-dynamic';

export default async function AgentConsole() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Admins can preview the agent console too — useful for QA — but the
  // primary audience is role=agent.
  const score = agentTodayScoreboard(user.id);
  const initial = [...listDialIntentsForUser(user.id, 20)].reverse();
  const inGroups = getInGroupsForAgent(user.id);
  // Iter 85 dance — node:sqlite returns null-prototype rows that
  // React 19 RSC refuses to serialize across the server/client
  // boundary. Same fix the realtime + dashboard pages apply.
  const initialStatus = JSON.parse(
    JSON.stringify(getAgentStatus(user.id)),
  );

  const onCallLabel = score.current_intent_id ? 'YES' : '—';
  const onCallTone = score.current_intent_id
    ? 'text-success'
    : 'text-fg-subtle';
  const statusTone =
    score.status === 'AVAILABLE'
      ? 'text-success'
      : score.status === 'PAUSED'
        ? 'text-warn'
        : score.status === 'WRAP_UP' || score.status === 'WRAP-UP'
          ? 'text-info'
          : 'text-fg';
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

  return (
    <SoftphoneProvider>
      <WrapUpOverlay />
      <div className="flex flex-col-reverse lg:flex-row gap-6 lg:items-start">
        <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-semibold">Agent console</h1>
          <div className="flex items-center gap-3">
            <PauseControl initial={initialStatus} />
            <AgentSoftphoneBadge />
          </div>
        </div>
        <p className="text-fg-subtle text-sm mb-1">
          Signed in as{' '}
          <span className="text-fg font-mono">{user.username}</span>{' '}
          <span className="text-fg-subtle">({user.role})</span>
        </p>
        <p className="text-fg-subtle text-sm mb-6">
          Calls assigned to you stream in below. The dialer bridges live
          calls straight to the softphone on the right &mdash; pause it
          when you need a break.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 max-w-4xl mb-6">
          <Stat
            label="On call"
            value={onCallLabel}
            accent={onCallTone}
            hint={
              score.current_phone
                ? `${score.current_phone} since ${new Date(score.current_answered_at ?? '').toLocaleTimeString()}`
                : 'No bridged call right now'
            }
          />
          <Stat
            label="Status"
            value={score.status.replace('_', '-')}
            accent={statusTone}
            hint={score.pause_reason ?? undefined}
          />
          <Stat
            label="Calls today"
            value={score.calls_today.toLocaleString()}
            accent={score.calls_today > 0 ? 'text-fg' : 'text-fg-subtle'}
            hint="originates assigned to you since midnight (UTC)"
          />
          <Stat
            label="Talked"
            value={score.talked_today.toLocaleString()}
            accent={score.talked_today > 0 ? 'text-success' : 'text-fg-subtle'}
            hint="calls that connected (answered_at set)"
          />
          <Stat
            label="Talk time"
            value={talkLabel}
            accent={
              score.talk_time_ms_today > 0 ? 'text-success' : 'text-fg-subtle'
            }
            hint="cumulative duration across today's connected calls"
          />
          <Stat
            label="Dispositions"
            value={score.dispositions_today.toLocaleString()}
            accent={
              score.dispositions_today > 0 ? 'text-success' : 'text-fg-subtle'
            }
            hint="outcomes you've logged today"
          />
        </div>

        <div className="border border-border rounded p-4 max-w-4xl mb-6">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
            My in-groups ({inGroups.length})
          </h2>
          {inGroups.length === 0 ? (
            <p className="text-fg-subtle text-sm">
              No inbound queues attached. An admin assigns in-groups to a
              campaign you&apos;re a member of so transferred / inbound
              calls can land with you.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {inGroups.map((g) => (
                <li
                  key={`${g.campaign_id}-${g.in_group_id}`}
                  className="flex items-center gap-3"
                >
                  <span className="font-mono">{g.in_group_name}</span>
                  <span className="text-fg-subtle text-xs">
                    via {g.campaign_name}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-fg-subtle mt-3">
            Live inbound delivery arrives with the Kamailio routing
            layer. For now this is the routing surface only.
          </p>
        </div>

        <div className="border border-border rounded p-4 max-w-4xl">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
            Assigned dial intents (live)
          </h2>
          <AgentFeed initial={initial} />
        </div>
        </div>

        <aside className="flex-shrink-0 lg:w-[340px]">
          <div className="lg:sticky lg:top-4">
            <AgentSoftphonePanel />
          </div>
        </aside>
      </div>
    </SoftphoneProvider>
  );
}

function Stat({
  label,
  value,
  accent = 'text-fg',
  hint,
}: {
  label: string;
  value: string;
  accent?: string;
  hint?: string;
}) {
  // Iter 98 — hover tooltip via `title`. With six stats on a row
  // the inline hint subtitle made each card 3 lines tall; tooltip
  // keeps the row compact while still surfacing the same context.
  return (
    <div
      title={hint}
      className={`border border-border rounded p-3 ${hint ? 'cursor-help' : ''}`}
    >
      <div className="text-xs text-fg-subtle uppercase">{label}</div>
      <div className={`text-xl mt-1 tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}
