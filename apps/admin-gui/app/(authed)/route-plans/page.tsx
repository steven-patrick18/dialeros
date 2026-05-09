import Link from 'next/link';
import {
  getCarrier,
  listCarriers,
  listRoutePlans,
  parseFailoverIds,
} from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

export default async function RoutePlansList() {
  const plans = listRoutePlans();
  const carriers = listCarriers();
  const carrierName = new Map(carriers.map((c) => [c.id, c.name]));
  const hasCarriers = carriers.length > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Route Plans</h1>
        {hasCarriers && (
          <Link
            href="/route-plans/add"
            className="bg-accent hover:bg-accent-hover text-white px-4 py-2 rounded text-sm"
          >
            + Add Route Plan
          </Link>
        )}
      </div>

      <p className="text-fg-subtle text-sm mb-6 max-w-2xl">
        A route plan bundles a primary carrier, optional failovers, caller-ID
        strategy, and number transformations. Campaigns reference route plans
        by name when dialing.
      </p>

      {!hasCarriers ? (
        <div className="border border-warn/40 bg-warn/10 rounded p-4 text-sm max-w-2xl">
          <p className="text-warn mb-2 font-medium">No carriers configured.</p>
          <p className="text-fg-muted">
            A route plan needs at least one carrier. Add one in{' '}
            <Link href="/carriers" className="underline">
              Carriers
            </Link>{' '}
            first.
          </p>
        </div>
      ) : plans.length === 0 ? (
        <div className="border border-dashed border-border rounded p-8 text-center max-w-2xl">
          <p className="text-fg-muted">No route plans defined.</p>
          <p className="text-fg-subtle text-sm mt-2">
            Click <span className="font-mono text-fg-muted">+ Add Route Plan</span>{' '}
            to create one.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-fg-subtle border-b border-border">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="font-medium">Primary carrier</th>
              <th className="font-medium">Failovers</th>
              <th className="font-medium">CID</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => {
              const failovers = parseFailoverIds(p);
              return (
                <tr key={p.id} className="border-b border-border/50">
                  <td className="py-3">
                    <Link
                      href={`/route-plans/${p.id}`}
                      className="hover:underline"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td className="text-fg-muted">
                    {carrierName.get(p.primary_carrier_id) ?? (
                      <span className="text-error">missing</span>
                    )}
                  </td>
                  <td className="text-fg-muted">
                    {failovers.length === 0
                      ? 'â€”'
                      : failovers
                          .map((id) => carrierName.get(id) ?? '?')
                          .join(', ')}
                  </td>
                  <td className="text-fg-muted">{p.cid_strategy}</td>
                  <td>
                    {p.enabled === 1 ? (
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
