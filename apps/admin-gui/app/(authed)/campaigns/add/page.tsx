import { redirect } from 'next/navigation';
import {
  leadCountFor,
  listLeadLists,
  listRoutePlans,
} from '@dialeros/control-plane';
import { AddCampaignForm } from './add-form';

export const dynamic = 'force-dynamic';

export default async function AddCampaignPage() {
  const routePlans = listRoutePlans();
  const leadLists = listLeadLists();
  if (routePlans.length === 0 || leadLists.length === 0) {
    redirect('/campaigns');
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-2">New Campaign</h1>
      <p className="text-fg-muted mb-6 text-sm max-w-xl">
        Pick a route plan, attach one or more lead lists, configure pacing and
        compliance. New campaigns start paused — you activate them on the
        detail page.
      </p>
      <AddCampaignForm
        routePlans={routePlans
          .filter((p) => p.enabled === 1)
          .map((p) => ({ id: p.id, name: p.name }))}
        leadLists={leadLists.map((l) => ({
          id: l.id,
          name: l.name,
          lead_count: leadCountFor(l.id),
        }))}
      />
    </div>
  );
}
