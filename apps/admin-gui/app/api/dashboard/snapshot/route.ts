import { NextResponse } from 'next/server';
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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Iter 96 — one-shot snapshot for the `/` dashboard's poll loop.
 * Rolls up floor throughput + per-campaign today counts + agent
 * status + cluster health into a single round trip so the
 * client-side poll doesn't fan out into 6 separate fetches every
 * 10 s. */
export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role === 'agent') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

  return NextResponse.json({
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
  });
}
