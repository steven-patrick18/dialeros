import { redirect } from 'next/navigation';
import {
  countDialIntentsForUser,
  listDialIntentsForUser,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { AgentFeed } from './agent-feed';

export const dynamic = 'force-dynamic';

export default async function AgentConsole() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Admins can preview the agent console too — useful for QA — but the
  // primary audience is role=agent.
  const total = countDialIntentsForUser(user.id);
  const initial = [...listDialIntentsForUser(user.id, 20)].reverse();

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Agent console</h1>
        <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
          AVAILABLE
        </span>
      </div>
      <p className="text-fg-subtle text-sm mb-1">
        Signed in as{' '}
        <span className="text-fg font-mono">{user.username}</span>{' '}
        <span className="text-fg-subtle">({user.role})</span>
      </p>
      <p className="text-fg-subtle text-sm mb-6">
        Calls assigned to you stream in below. Real telephony arrives with
        the FreeSWITCH bridge — for now this is the dial-intent feed only.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl mb-6">
        <Stat label="Calls today" value="—" hint="Per-day rollup TBD" />
        <Stat label="On call" value="—" hint="Telephony layer TBD" />
        <Stat label="Wrap-up" value="—" hint="Telephony layer TBD" />
        <Stat
          label="Intents assigned"
          value={total.toLocaleString()}
          accent={total > 0 ? 'text-fg' : 'text-fg-subtle'}
        />
      </div>

      <div className="border border-border rounded p-4 max-w-4xl">
        <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-3">
          Assigned dial intents (live)
        </h2>
        <AgentFeed initial={initial} />
      </div>
    </div>
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
