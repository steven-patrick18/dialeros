import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  inFlightForRemoteAgent,
  listRemoteAgents,
  remoteLineCapacity,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function RemoteAgentsPage() {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-2">Remote Agents</h1>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  const agents = listRemoteAgents();
  const totalLines = remoteLineCapacity();

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Remote Agents</h1>
        <Link
          href="/remote-agents/add"
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm"
        >
          + New Remote Agent
        </Link>
      </div>

      <p className="text-fg-subtle text-sm mb-2 max-w-3xl">
        External SIP endpoints — hard phones at remote offices, shared
        trunks to a partner contact centre, etc. — that participate in
        the pacing pool alongside browser-based local agents. Each one
        has a <span className="font-mono">lines</span> capacity counted
        into the pacer&apos;s dial-level math:{' '}
        <span className="font-mono">
          (local_agents + Σ remote_agent_lines) × dial_level
        </span>
        .
      </p>
      <p className="text-fg-subtle text-xs mb-6">
        <span className="font-mono">{totalLines}</span> total line capacity
        across enabled remote agents. The pacer multiplies this (plus
        local active-agent count) by each campaign&apos;s dial_level on
        every tick.
      </p>

      {agents.length === 0 ? (
        <div className="border border-dashed border-border rounded p-6 text-sm text-fg-subtle">
          No remote agents yet. Add one to expose extra dialing capacity
          beyond the browser-based agents.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-fg-subtle border-b border-border">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="font-medium">SIP URI</th>
              <th className="font-medium tabular-nums">In-flight / Lines</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const inFlight = inFlightForRemoteAgent(a.id);
              const atCap = a.enabled === 1 && inFlight >= a.lines;
              return (
                <tr key={a.id} className="border-b border-border/50">
                  <td className="py-3">
                    <Link
                      href={`/remote-agents/${a.id}`}
                      className="hover:underline"
                    >
                      {a.name}
                    </Link>
                  </td>
                  <td className="text-fg-muted font-mono text-xs break-all">
                    {a.sip_uri}
                  </td>
                  <td className="tabular-nums">
                    <span className={atCap ? 'text-warn' : 'text-fg'}>
                      {inFlight}
                    </span>
                    <span className="text-fg-subtle"> / {a.lines}</span>
                  </td>
                  <td>
                    {a.enabled === 1 ? (
                      <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
                        ENABLED
                      </span>
                    ) : (
                      <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
                        DISABLED
                      </span>
                    )}
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
