import { notFound } from 'next/navigation';
import { getCampaign, getRoutePlan } from '@dialeros/control-plane';
import { EditCampaignForm } from './edit-form';

export const dynamic = 'force-dynamic';

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const c = getCampaign(id);
  if (!c) notFound();
  const rp = getRoutePlan(c.route_plan_id);
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">
        Edit campaign: <span className="text-accent">{c.name}</span>
      </h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Route plan ({rp?.name ?? 'missing'}) and attached lead lists are
        locked once the campaign exists. To change them, delete and recreate.
      </p>
      <EditCampaignForm
        campaign={{
          id: c.id,
          name: c.name,
          description: c.description,
          type: c.type,
          base_ratio: c.base_ratio,
          call_window_start: c.call_window_start,
          call_window_end: c.call_window_end,
          max_abandon_pct: c.max_abandon_pct,
        }}
      />
    </div>
  );
}
