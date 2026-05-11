import { NextResponse } from 'next/server';
import {
  carrierLiveSnapshot,
  listActiveCalls,
  liveAgentSnapshot,
  liveCampaignSnapshot,
  remoteLineCapacity,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 67 — one-shot snapshot for the /realtime page. Campaigns +
// agents + active calls in a single round-trip so the polling loop
// doesn't fire three independent fetches every 2s.

export async function GET() {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin' && me.role !== 'supervisor') {
    return NextResponse.json(
      { error: 'Admin or supervisor role required' },
      { status: 403 },
    );
  }
  const campaigns = liveCampaignSnapshot();
  const agents = liveAgentSnapshot();
  const active_calls = listActiveCalls();
  // Iter 85 — per-carrier live snapshot (dialing / connected / 1m /
  // 10m / 60m + completed/failed last 60m).
  const carriers = carrierLiveSnapshot();
  return NextResponse.json({
    generated_at: new Date().toISOString(),
    remote_line_capacity: remoteLineCapacity(),
    campaigns,
    agents,
    active_calls,
    carriers,
  });
}
