import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  clearHopper,
  getCampaign,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Iter 70 — wipe a campaign's hopper. The next pacer tick will
// rebuild it from scratch using the current list_order strategy.
// Useful after switching strategy, after importing a fresh batch
// of leads, or as a "kick" when the hopper picked stale entries.

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
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
  const { id } = await ctx.params;
  const campaign = getCampaign(id);
  if (!campaign) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const removed = clearHopper(id);
  appendAudit({
    actorUserId: me.id,
    actorIp: clientIp(req),
    action: 'campaign.hopper_reset',
    targetType: 'campaign',
    targetId: id,
    payload: { removed, list_order: campaign.list_order },
  });
  return NextResponse.json({ ok: true, removed });
}
