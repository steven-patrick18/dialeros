import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  APP_SETTING_KEYS,
  hasAppSetting,
  listCarriers,
  listNodesFromDb,
  type NodeRecord,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { getFreeSwitchHealth, type FreeSwitchHealth } from '@/lib/esl';
import { TokenForm } from './token-form';
import { InstallPanel } from './install-panel';
import { TestCallCard } from './test-call-card';
import { SoftphoneProvider } from '@/components/softphone';

export const dynamic = 'force-dynamic';

export default async function TelephonySettings() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') {
    return (
      <div>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }

  const hasToken = hasAppSetting(APP_SETTING_KEYS.signalwireToken);
  const telephonyNodes = listNodesFromDb().filter(
    (n) => n.role === 'telephony',
  );
  const carriers = listCarriers();
  // Ping each remote node's ESL (best-effort, parallel, short timeout so
  // one unreachable node doesn't block the page).
  const remoteHealths = await Promise.all(
    telephonyNodes.map(async (n) => ({
      node: n,
      health: await getFreeSwitchHealth({ host: n.host, timeoutMs: 1500 }),
    })),
  );

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          &larr; Dashboard
        </Link>
      </div>
      <h1 className="text-2xl font-semibold mb-1">Telephony</h1>
      <p className="text-fg-subtle text-sm mb-6 max-w-3xl">
        FreeSWITCH is the media + dialplan engine. The token below is{' '}
        <span className="text-fg">global</span> &mdash; one per DialerOS
        deployment, stored encrypted &mdash; and reused to install FreeSWITCH
        on <span className="text-fg">every</span> telephony node, whether
        that&apos;s this admin host alone, or a separate cluster of media
        boxes you provision in{' '}
        <Link
          href="/cluster/nodes"
          className="text-accent hover:underline"
        >
          Cluster Nodes
        </Link>
        .
      </p>

      <div className="max-w-4xl space-y-6">
        <TokenForm hasToken={hasToken} />

        <section>
          <h2 className="text-sm font-medium mb-2">This host</h2>
          <p className="text-xs text-fg-subtle mb-3 max-w-3xl">
            The host running this admin GUI. Install FreeSWITCH here for a
            single-box setup, or skip this section if you&apos;re running a
            split deployment (admin on one box, telephony on others).
          </p>
          <InstallPanel hasToken={hasToken} />
        </section>

        <section>
          <h2 className="text-sm font-medium mb-2">Test call</h2>
          <p className="text-xs text-fg-subtle mb-3 max-w-3xl">
            Quick way to confirm a carrier is wired all the way through:
            FreeSWITCH up &rarr; gateway pushed &rarr; SIP registered &rarr;
            INVITE actually reaches the destination. Skip this section if
            FreeSWITCH isn&apos;t running yet &mdash; the originate will
            fail at the ESL connect.
          </p>
          <SoftphoneProvider>
            <TestCallCard
              carriers={carriers.map((c) => ({
                id: c.id,
                name: c.name,
                enabled: c.enabled === 1,
              }))}
            />
          </SoftphoneProvider>
        </section>

        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-medium">
              Cluster telephony nodes ({telephonyNodes.length})
            </h2>
            <Link
              href="/cluster/nodes"
              className="text-xs text-fg-muted hover:text-fg"
            >
              Manage nodes &rarr;
            </Link>
          </div>
          <p className="text-xs text-fg-subtle mb-3 max-w-3xl">
            Nodes registered with role <span className="font-mono">telephony</span>.
            Each runs its own FreeSWITCH instance, all sharing this single
            global SignalWire token for installs and updates. Remote install
            via SSH lands once the real Ansible runner replaces the iter-1
            simulation &mdash; for now their ESL reachability is shown for
            visibility.
          </p>

          {telephonyNodes.length === 0 ? (
            <div className="border border-dashed border-border rounded p-6 text-sm text-fg-subtle">
              No telephony nodes registered yet. Single-box installs use
              <span className="font-mono"> This host </span>
              above. To run FreeSWITCH on a separate machine, add it under{' '}
              <Link
                href="/cluster/nodes/add"
                className="text-accent hover:underline"
              >
                Cluster Nodes &rarr; New
              </Link>{' '}
              with role <span className="font-mono">telephony</span>.
            </div>
          ) : (
            <ul className="space-y-2">
              {remoteHealths.map(({ node, health }) => (
                <RemoteNodeRow key={node.id} node={node} health={health} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function RemoteNodeRow({
  node,
  health,
}: {
  node: NodeRecord;
  health: FreeSwitchHealth;
}) {
  return (
    <li className="border border-border rounded p-3 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Link
            href={`/cluster/nodes/${node.id}`}
            className="hover:underline font-medium"
          >
            {node.name}
          </Link>
          <span className="text-fg-subtle text-xs font-mono">
            {node.host}
          </span>
          <span
            className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${
              node.status === 'READY'
                ? 'bg-success/10 text-success border-success/40'
                : node.status === 'PROVISIONING'
                  ? 'bg-warn/10 text-warn border-warn/40'
                  : 'bg-error/10 text-error border-error/40'
            }`}
          >
            {node.status}
          </span>
        </div>
        <div className="text-xs text-fg-subtle mt-1">
          {health.reachable ? (
            <>
              <span className="text-success">FreeSWITCH up</span>
              {health.version && (
                <span className="ml-2 font-mono">{health.version}</span>
              )}
              {health.uptime && (
                <span className="ml-2">uptime {health.uptime}</span>
              )}
            </>
          ) : (
            <>
              <span className="text-fg-muted">FreeSWITCH not reachable</span>
              <span className="ml-2 font-mono">
                {health.errorCode ?? 'unknown'}
              </span>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        disabled
        className="bg-card-hover text-fg-muted px-3 py-1.5 rounded text-xs cursor-not-allowed"
        title="Remote install lands with the real Ansible runner (iter 30+)."
      >
        Install (coming)
      </button>
    </li>
  );
}
