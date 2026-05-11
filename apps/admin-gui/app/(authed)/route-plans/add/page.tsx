import { redirect } from 'next/navigation';
import {
  countCidsInGroup,
  listCarriers,
  listCidGroups,
} from '@dialeros/control-plane';
import { AddRoutePlanForm } from './add-form';

export const dynamic = 'force-dynamic';

export default async function AddRoutePlanPage() {
  const carriers = listCarriers();
  if (carriers.length === 0) {
    redirect('/route-plans');
  }
  const cidGroups = listCidGroups().map((g) => ({
    id: g.id,
    name: g.name,
    strategy: g.strategy,
    cid_count: countCidsInGroup(g.id),
  }));
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">Add Route Plan</h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Bundle a carrier, optional failovers, caller-ID behavior, and number
        transforms into a named route. Campaigns reference this name when
        dialing.
      </p>
      <AddRoutePlanForm
        carriers={carriers.map((c) => ({
          id: c.id,
          name: c.name,
          host: c.host,
          enabled: c.enabled === 1,
        }))}
        cidGroups={cidGroups}
      />
    </div>
  );
}
