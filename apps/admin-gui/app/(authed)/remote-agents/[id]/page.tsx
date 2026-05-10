import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  getRemoteAgent,
  listNodesFromDb,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { InlineCardForm } from '@/components/inline-card-form';
import { DeleteRemoteAgentButton } from './delete-button';

export const dynamic = 'force-dynamic';

export default async function RemoteAgentDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await getCurrentUser();
  if (!me) redirect('/login');
  if (me.role !== 'admin') {
    return (
      <div>
        <p className="text-error text-sm">Admin role required.</p>
      </div>
    );
  }
  const { id } = await params;
  const r = getRemoteAgent(id);
  if (!r) notFound();

  const telephonyNodes = listNodesFromDb().filter(
    (n) => n.role === 'telephony',
  );
  const nodeOptions = [
    { value: '', label: '(any node)' },
    ...telephonyNodes.map((n) => ({ value: n.id, label: n.name })),
  ];

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/remote-agents"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          ← Remote Agents
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">{r.name}</h1>
        {r.enabled === 1 ? (
          <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
            ENABLED
          </span>
        ) : (
          <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
            DISABLED
          </span>
        )}
      </div>
      <p className="text-fg-subtle text-sm mb-6 font-mono">{r.sip_uri}</p>

      <div className="max-w-2xl mb-6">
        <InlineCardForm
          title="Remote agent"
          endpoint={`/api/remote-agents/${r.id}`}
          fields={[
            {
              type: 'text',
              name: 'name',
              label: 'Name',
              value: r.name,
              maxLength: 64,
              hint: 'Internal identifier. Alphanumeric, dashes / underscores.',
            },
            {
              type: 'text',
              name: 'sip_uri',
              label: 'SIP URI',
              value: r.sip_uri,
              placeholder: 'sip:1500@10.0.0.5',
              hint: 'Destination for the pacer-originated INVITE. sip:user@host[:port].',
            },
            {
              type: 'number',
              name: 'lines',
              label: 'Lines',
              value: r.lines,
              min: 1,
              max: 64,
              step: 1,
              hint: 'Maximum concurrent calls this remote agent will accept. Multiplied into the pacer\'s dial-level math.',
            },
            {
              type: 'select',
              name: 'telephony_node_id',
              label: 'Telephony node',
              value: r.telephony_node_id ?? '',
              options: nodeOptions,
              hint: 'Bind to a specific telephony node. Leave on (any node) to let the pacer pick.',
            },
            {
              type: 'boolean',
              name: 'enabled',
              label: 'Enabled',
              value: r.enabled === 1,
              hint: 'Disabled remote agents stay in inventory but contribute zero lines to the pacer.',
            },
          ]}
        />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs max-w-2xl mb-6">
        <Detail label="ID" value={<span className="font-mono">{r.id}</span>} />
        <Detail
          label="Created"
          value={new Date(r.created_at).toLocaleString()}
        />
      </dl>

      <DeleteRemoteAgentButton id={r.id} name={r.name} />
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-fg-subtle uppercase">{label}</dt>
      <dd className="text-fg mt-0.5">{value}</dd>
    </div>
  );
}
