import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getNodeFromDb } from '@dialeros/control-plane';
import { ProvisionLog } from '@/components/provision-log';

export const dynamic = 'force-dynamic';

export default async function NodeDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const node = getNodeFromDb(id);
  if (!node) notFound();

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/cluster/nodes"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          â† Cluster Nodes
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">{node.name}</h1>
      <p className="text-fg-subtle text-sm mb-6 font-mono">
        {node.host}:{node.port} Â· {node.role}
      </p>

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
        Tip â€” provision a node with <span className="font-mono text-fg-muted">fail</span>{' '}
        in the name (e.g. <span className="font-mono text-fg-muted">test-fail</span>) to
        deterministically trigger a FAILED outcome and exercise the error path.
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
