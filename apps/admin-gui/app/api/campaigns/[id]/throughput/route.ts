import { NextResponse } from 'next/server';
import {
  campaignThroughput,
  getCampaign,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Iter 84 — periodic snapshot for the Real-Time panel header.
 * Returns active-now + windowed throughput counts (1m / 10m / 60m).
 * Cheap query backed by indexed (campaign_id, ts) lookups; safe to
 * poll every few seconds. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  if (!getCampaign(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json(campaignThroughput(id));
}
