import { NextResponse } from 'next/server';
import {
  getCampaign,
  getCampaignAbandonRate,
} from '@dialeros/control-plane';
import { getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 147 — GET /api/campaigns/:id/abandon-rate
// Live rolling abandon-rate for the campaign + the configured cap.
// Used by the abandon-rate card on the campaign detail page; also
// useful for any external monitor that wants to poll
// "is this campaign throttled?".
//
// Returns:
//   {
//     campaign_id, max_abandon_pct,
//     abandoned, total, rate_pct, sample_size,
//     throttled    // true if pacer is currently skipping ticks
//   }
//
// Auth: any authenticated user can read (consistent with other
// per-campaign read endpoints).

const MIN_ABANDON_SAMPLE = 50;

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const rate = getCampaignAbandonRate(id, 100);
  const throttled =
    rate.total >= MIN_ABANDON_SAMPLE &&
    campaign.max_abandon_pct > 0 &&
    rate.rate_pct >= campaign.max_abandon_pct;
  return NextResponse.json({
    campaign_id: id,
    max_abandon_pct: campaign.max_abandon_pct,
    abandoned: rate.abandoned,
    total: rate.total,
    rate_pct: rate.rate_pct,
    sample_size: rate.sample_size,
    min_sample: MIN_ABANDON_SAMPLE,
    throttled,
  });
}
