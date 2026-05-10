import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getNodeFromDb, parseNodeRoles } from '@dialeros/control-plane';
import { ProvisionLog } from '@/components/provision-log';
import { RolesEditor } from './roles-editor';

export const dynamic = 'force-dynamic';

export default async function NodeDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const node = getNodeFromDb(id);
  if (!node) notFound();

  const roles = parseNodeRoles(node);

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/cluster/nodes"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          ← Cluster Nodes
        </Link>
      </div>
      <div className="flex items-center gap-3 mb-1">
        <h1 className="text-2xl font-semibold">{node.name}</h1>
        {node.is_self === 1 && (
          <span className="bg-accent/15 text-accent border border-accent/50 px-2 py-0.5 rounded text-xs uppercase tracking-wide">
            This host
          </span>
        )}
      </div>
      <p className="text-fg-subtle text-sm mb-6 font-mono">
        {node.host}:{node.port}
      </p>

      <div className="max-w-2xl mb-6">
        <RolesEditor nodeId={node.id} initialRoles={roles} />
      </div>

      <ProvisionLog
        nodeId={node.id}
        initialStatus={node.status}
        initialError={node.error_message}
      />

      <dl className="mt-6 grid grid-cols-2 gap-3 text-xs max-w-3xl">
        <Detail
          label="ID"
          value={<span className="font-mono">{node.id}</span>}
        />
        <Detail label="SSH user" value={node.ssh_user} />
        <Detail
          label="Created"
          value={new Date(node.created_at).toLocaleString()}
        />
        <Detail
          label="Updated"
          value={new Date(node.updated_at).toLocaleString()}
        />
      </dl>

      <p className="text-xs text-fg-subtle mt-6 max-w-3xl">
        Tip — provision a node with{' '}
        <span className="font-mono text-fg-muted">fail</span> in the
        name (e.g. <span className="font-mono text-fg-muted">test-fail</span>) to deterministically trigger a FAILED outcome and
        exercise the error path.
      </p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-fg-subtle uppercase">{label}</dt>
      <dd className="text-fg mt-0.5">{value}</dd>
    </div>
  );
}
