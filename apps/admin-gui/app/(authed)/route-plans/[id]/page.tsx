import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getCarrier,
  getRoutePlan,
  parseCidPool,
  parseFailoverIds,
} from '@dialeros/control-plane';
import { DeleteRoutePlanButton } from './delete-button';

export const dynamic = 'force-dynamic';

export default async function RoutePlanDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plan = getRoutePlan(id);
  if (!plan) notFound();

  const primary = getCarrier(plan.primary_carrier_id);
  const failoverIds = parseFailoverIds(plan);
  const failovers = failoverIds.map((fid) => getCarrier(fid));
  const cidPool = parseCidPool(plan);

  const exampleNumber = '+14155551234';
  const transformed = applyTransform(
    exampleNumber,
    plan.transform_strip_prefix,
    plan.transform_add_prefix,
  );

  return (
    <div>
      <div className="mb-1">
        <Link
          href="/route-plans"
          className="text-xs text-fg-subtle hover:text-fg-muted"
        >
          â† Route Plans
        </Link>
      </div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">{plan.name}</h1>
        {plan.enabled === 1 ? (
          <span className="bg-success/15 text-success border border-success/50 px-2 py-0.5 rounded text-xs">
            ENABLED
          </span>
        ) : (
          <span className="bg-card-hover/40 text-fg-muted border border-border px-2 py-0.5 rounded text-xs">
            DISABLED
          </span>
        )}
      </div>
      {plan.description && (
        <p className="text-fg-muted text-sm mb-6">{plan.description}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl">
        <Card title="Primary carrier">
          {primary ? (
            <Link
              href={`/carriers/${primary.id}`}
              className="text-sm hover:underline"
            >
              {primary.name}
              <span className="text-fg-subtle ml-2 font-mono text-xs">
                {primary.host}:{primary.port}
              </span>
            </Link>
          ) : (
            <p className="text-error text-sm">
              Primary carrier missing â€” was it deleted?
            </p>
          )}
        </Card>

        <Card title={`Failover carriers (${failovers.length})`}>
          {failovers.length === 0 ? (
            <p className="text-fg-subtle text-sm">No failovers configured.</p>
          ) : (
            <ol className="space-y-1 text-sm">
              {failovers.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="text-fg-subtle tabular-nums w-4">
                    {i + 1}.
                  </span>
                  {c ? (
                    <Link
                      href={`/carriers/${c.id}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                  ) : (
                    <span className="text-error">missing carrier</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Caller ID">
          <Detail label="Strategy" value={plan.cid_strategy} />
          {plan.cid_strategy === 'single' && (
            <Detail
              label="Number"
              value={
                <span className="font-mono text-xs">
                  {plan.cid_single ?? 'â€”'}
                </span>
              }
            />
          )}
          {plan.cid_strategy === 'rotate' && (
            <>
              <Detail
                label="Pool size"
                value={<span className="tabular-nums">{cidPool.length}</span>}
              />
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-fg-subtle hover:text-fg-muted">
                  Show pool
                </summary>
                <ul className="mt-2 max-h-40 overflow-y-auto space-y-0.5 font-mono text-fg-muted">
                  {cidPool.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </Card>

        <Card title="Number transform">
          <Detail
            label="Strip prefix"
            value={
              plan.transform_strip_prefix ? (
                <span className="font-mono text-xs">
                  {plan.transform_strip_prefix}
                </span>
              ) : (
                'â€”'
              )
            }
          />
          <Detail
            label="Add prefix"
            value={
              plan.transform_add_prefix ? (
                <span className="font-mono text-xs">
                  {plan.transform_add_prefix}
                </span>
              ) : (
                'â€”'
              )
            }
          />
          <div className="mt-3 pt-3 border-t border-border text-xs">
            <div className="text-fg-subtle mb-1">Example</div>
            <div className="font-mono">
              <span className="text-fg-muted">{exampleNumber}</span>
              <span className="text-fg-subtle mx-2">â†’</span>
              <span className="text-fg">{transformed}</span>
            </div>
          </div>
        </Card>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-3 text-xs max-w-4xl">
        <Detail label="ID" value={<span className="font-mono">{plan.id}</span>} />
        <Detail
          label="Created"
          value={new Date(plan.created_at).toLocaleString()}
        />
      </dl>

      <div className="mt-8 max-w-4xl">
        <DeleteRoutePlanButton id={plan.id} name={plan.name} />
      </div>
    </div>
  );
}

function applyTransform(
  number: string,
  strip: string | null,
  add: string | null,
): string {
  let result = number;
  if (strip && result.startsWith(strip)) {
    result = result.slice(strip.length);
  }
  if (add) {
    result = add + result;
  }
  return result;
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
