import { notFound } from 'next/navigation';
import {
  countCidsInGroup,
  getCarrier,
  getRoutePlan,
  listCarriers,
  listCidGroups,
  parseCidGroupIds,
  parseCidPool,
  parseFailoverIds,
} from '@dialeros/control-plane';
import { EditRoutePlanForm } from './edit-form';

export const dynamic = 'force-dynamic';

export default async function EditRoutePlanPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const plan = getRoutePlan(id);
  if (!plan) notFound();
  const primary = getCarrier(plan.primary_carrier_id);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">
        Edit route plan: <span className="text-accent">{plan.name}</span>
      </h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Primary carrier ({primary?.name ?? 'missing'}) is locked. To change
        it, delete and recreate.
      </p>
      <EditRoutePlanForm
        plan={{
          id: plan.id,
          name: plan.name,
          description: plan.description,
          primary_carrier_id: plan.primary_carrier_id,
          failover_carrier_ids: parseFailoverIds(plan),
          cid_strategy: plan.cid_strategy,
          cid_single: plan.cid_single,
          cid_pool: parseCidPool(plan),
          cid_group_ids: parseCidGroupIds(plan),
          transform_strip_prefix: plan.transform_strip_prefix,
          transform_add_prefix: plan.transform_add_prefix,
          enabled: plan.enabled === 1,
        }}
        carriers={listCarriers().map((c) => ({
          id: c.id,
          name: c.name,
          host: c.host,
          enabled: c.enabled === 1,
        }))}
        cidGroups={listCidGroups().map((g) => ({
          id: g.id,
          name: g.name,
          strategy: g.strategy,
          cid_count: countCidsInGroup(g.id),
        }))}
      />
    </div>
  );
}
