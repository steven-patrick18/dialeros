import { redirect } from 'next/navigation';
import {
  floorThroughputSnapshot,
  listCampaigns,
  listCarriers,
  listNodesFromDb,
  listRoutePlans,
  liveAgentSnapshot,
  topCampaignsToday,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';
import { DashboardBoard } from './dashboard-board';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const me = await getCurrentUser();
  if (me?.role === 'agent') {
    // Agents land on their own console — the cluster dashboard is
    // admin / supervisor only.
    redirect('/agent');
  }
  const floor = floorThroughputSnapshot();
  const campaignsToday = topCampaignsToday(8);
  const agents = liveAgentSnapshot();
  const agentsAvailable = agents.filter(
    (a) => a.status === 'AVAILABLE' && a.call_intent_id === null,
  ).length;
  const agentsInCall = agents.filter(
    (a) => a.call_intent_id !== null,
  ).length;
  const agentsPaused = agents.filter(
    (a) => a.status === 'PAUSED' && a.call_intent_id === null,
  ).length;
  const dispoToday = agents.reduce(
    (a, x) => a + x.dispositions_today,
    0,
  );
  const nodes = listNodesFromDb();
  const carriers = listCarriers();
  const routePlans = listRoutePlans();
  const campaigns = listCampaigns();

  // Iter 96 — JSON roundtrip strips node:sqlite's null-prototype
  // rows (same fix iter 85 applied on /realtime). Without it
  // React 19 RSC refuses to serialize to the client component.
  const initial = JSON.parse(
    JSON.stringify({
      generated_at: new Date().toISOString(),
      floor,
      campaigns_today: campaignsToday,
      agents: {
        total: agents.length,
        available: agentsAvailable,
        in_call: agentsInCall,
        paused: agentsPaused,
        dispo_today: dispoToday,
      },
      health: {
        nodes_total: nodes.length,
        nodes_ready: nodes.filter((n) => n.status === 'READY').length,
        carriers_total: carriers.length,
        carriers_enabled: carriers.filter((c) => c.enabled === 1).length,
        route_plans_total: routePlans.length,
        route_plans_enabled: routePlans.filter((p) => p.enabled === 1).length,
        campaigns_total: campaigns.length,
        campaigns_active: campaigns.filter((c) => c.status === 'active').length,
      },
    }),
  );

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Dashboard</h1>
      <p className="text-fg-muted text-sm mb-6">
        Floor pulse — live calls, today&apos;s outcomes, top campaigns,
        and cluster health. Refreshes every 10 seconds.
      </p>
      <DashboardBoard initial={initial} />
    </div>
  );
}
