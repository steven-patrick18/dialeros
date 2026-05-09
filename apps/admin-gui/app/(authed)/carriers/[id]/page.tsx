import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getCarrier,
  getRoutePlansForCarrier,
  parseCodecs,
} from '@dialeros/control-plane';
import { DeleteCarrierButton } from './delete-button';

export const dynamic = 'force-dynamic';

export default async function CarrierDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const carrier = getCarrier(id);
  if (!carrier) notFound();

  const codecs = parseCodecs(carrier);
  const usedBy = getRoutePlansForCarrier(id);

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/carriers"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          â† Carriers
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">{carrier.name}</h1>
        {carrier.enabled === 1 ? (
          <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
            ENABLED
          </span>
        ) : (
          <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
            DISABLED
          </span>
        )}
      </div>
      <p className="text-fg-subtle text-sm mb-6 font-mono">
        {carrier.transport}://{carrier.host}:{carrier.port}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        <Card title="Authentication">
          <Detail label="Mode" value={carrier.auth_mode} />
          {carrier.auth_mode === 'digest' && (
            <>
              <Detail
                label="Username"
                value={carrier.digest_username ?? 'â€”'}
              />
              <Detail
                label="Password"
                value={
                  carrier.digest_password_encrypted ? (
                    <span className="text-fg-subtle">
                      â—â—â—â—â—â—â—â— (encrypted at rest)
                    </span>
                  ) : (
                    'â€”'
                  )
                }
              />
            </>
          )}
          {carrier.auth_mode === 'ip-acl' && (
            <Detail
              label="Allowed IPs"
              value={
                <span className="font-mono text-xs">
                  {carrier.ip_acl ?? 'â€”'}
                </span>
              }
            />
          )}
        </Card>

        <Card title="Codecs (preference order)">
          {codecs.length === 0 ? (
            <p className="text-fg-subtle text-sm">No codecs configured.</p>
          ) : (
            <ol className="space-y-1">
              {codecs.map((c, i) => (
                <li
                  key={c}
                  className="flex items-center gap-3 text-sm"
                >
                  <span className="text-fg-subtle tabular-nums w-4">
                    {i + 1}.
                  </span>
                  <span className="font-mono">{c}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Capacity">
          <Detail
            label="Max channels"
            value={
              <span className="tabular-nums">{carrier.max_channels}</span>
            }
          />
          <Detail
            label="Max CPS"
            value={<span className="tabular-nums">{carrier.max_cps}</span>}
          />
        </Card>

        <Card title="Quality">
          <Detail
            label="MOS threshold"
            value={
              <span className="tabular-nums">
                {carrier.mos_threshold.toFixed(1)}
              </span>
            }
          />
          <p className="text-xs text-fg-subtle mt-2">
            Active quality probing is a planned feature.
          </p>
        </Card>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-xs max-w-4xl">
        <Detail label="ID" value={<span className="font-mono">{carrier.id}</span>} />
        <Detail
          label="Created"
          value={new Date(carrier.created_at).toLocaleString()}
        />
      </dl>

      {usedBy.length > 0 && (
        <div className="mt-6 border border-border rounded p-4 max-w-4xl">
          <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
            Used by route plans ({usedBy.length})
          </h2>
          <ul className="space-y-1 text-sm">
            {usedBy.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/route-plans/${p.id}`}
                  className="hover:underline"
                >
                  {p.name}
                </Link>
                <span className="text-fg-subtle ml-2 text-xs">
                  {p.primary_carrier_id === carrier.id
                    ? '(primary)'
                    : '(failover)'}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-fg-subtle mt-3">
            Deletion is blocked while this carrier is referenced.
          </p>
        </div>
      )}

      <div className="mt-8 max-w-4xl flex items-center gap-4">
        <Link
          href={`/carriers/${carrier.id}/edit`}
          className="bg-accent hover:bg-accent-hover text-accent-fg px-4 py-2 rounded text-sm"
        >
          Edit carrier
        </Link>
        <DeleteCarrierButton id={carrier.id} name={carrier.name} />
      </div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-border rounded p-4 space-y-2">
      <h2 className="text-xs uppercase tracking-wide text-fg-muted mb-2">
        {title}
      </h2>
      {children}
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
    <div className="flex justify-between gap-4 text-sm">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="text-fg text-right">{value}</dd>
    </div>
  );
}
