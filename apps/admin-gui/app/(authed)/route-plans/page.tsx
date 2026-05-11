import Link from 'next/link';
import {
  listCarriers,
  listCarriersForRoutePlan,
  listRoutePlans,
} from '@dialeros/control-plane';

export const dynamic = 'force-dynamic';

export default async function RoutePlansList() {
  const plans = listRoutePlans();
  const carriers = listCarriers();
  const carrierName = new Map(carriers.map((c) => [c.id, c.name]));
  const hasCarriers = carriers.length > 0;

  // Iter 75 — show every attached carrier with its priority, not just
  // primary + failovers. Same priority across rows = round-robin
  // within that tier, which the pacer respects.
  const planCarriers = new Map(
    plans.map((p) => [p.id, listCarriersForRoutePlan(p.id)]),
  );

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
        A route plan bundles one or more carriers (with priority + port
        allocation per carrier), a caller-ID strategy, and number
        transformations. Campaigns reference route plans by name when
        dialing.
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
              <th className="font-medium">Carriers (priority · ports)</th>
              <th className="font-medium">CID</th>
              <th className="font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => {
              const rows = planCarriers.get(p.id) ?? [];
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
                  <td className="text-fg-muted text-xs">
                    {rows.length === 0 ? (
                      <span className="text-error">none attached</span>
                    ) : (
                      rows.map((r, idx) => {
                        const name = carrierName.get(r.carrier_id) ?? '?';
                        return (
                          <span key={r.id}>
                            {idx > 0 && (
                              <span className="text-fg-subtle"> · </span>
                            )}
                            <span className="text-fg">{name}</span>
                            <span className="text-fg-subtle">
                              {' '}
                              (p{r.priority}/{r.ports})
                            </span>
                          </span>
                        );
                      })
                    )}
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
