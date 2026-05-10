import { redirect } from 'next/navigation';
import {
  countDialIntentsForUser,
  countDispositionsTodayForUser,
  getInGroupsForAgent,
  listDialIntentsForUser,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { SoftphoneProvider } from '@/components/softphone';
import { AgentFeed } from './agent-feed';
import { AgentSoftphoneBadge } from './softphone-badge';
import { AgentSoftphonePanel } from './softphone-panel';
import { WrapUpOverlay } from './wrap-up-overlay';

export const dynamic = 'force-dynamic';

export default async function AgentConsole() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Admins can preview the agent console too — useful for QA — but the
  // primary audience is role=agent.
  const total = countDialIntentsForUser(user.id);
  const dispoToday = countDispositionsTodayForUser(user.id);
  const initial = [...listDialIntentsForUser(user.id, 20)].reverse();
  const inGroups = getInGroupsForAgent(user.id);

  return (
    <SoftphoneProvider>
      <WrapUpOverlay />
      <div className="flex flex-col-reverse lg:flex-row gap-6 lg:items-start">
        <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-semibold">Agent console</h1>
          <div className="flex items-center gap-3">
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mb-6">
          <Stat
            label="Dispositions today"
            value={dispoToday.toLocaleString()}
            accent={dispoToday > 0 ? 'text-success' : 'text-fg-subtle'}
          />
          <Stat label="On call" value="—" hint="Bridge from pacer TBD" />
          <Stat label="Wrap-up" value="—" hint="Disposition flow TBD" />
          <Stat
            label="Intents assigned"
            value={total.toLocaleString()}
            accent={total > 0 ? 'text-fg' : 'text-fg-subtle'}
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
  return (
    <div className="border border-border rounded p-3">
      <div className="text-xs text-fg-subtle uppercase">{label}</div>
      <div className={`text-xl mt-1 tabular-nums ${accent}`}>{value}</div>
      {hint && (
        <div className="text-[10px] text-fg-subtle mt-1">{hint}</div>
      )}
    </div>
  );
}
