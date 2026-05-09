import { NextRequest, NextResponse } from 'next/server';
import {
  CampaignStatusSchema,
  appendAudit,
  getCampaign,
  setCampaignStatus,
  startPacer,
  stopPacer,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const existing = getCampaign(id);
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = CampaignStatusSchema.safeParse((raw as { status?: unknown }).status);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'status must be one of: paused, active, archived' },
      { status: 400 },
    );
  }

  const newStatus = parsed.data;
  if (newStatus === existing.status) {
    return NextResponse.json({ ok: true, status: newStatus });
  }

  setCampaignStatus(id, newStatus);

  // Iter 11: pacer lifecycle is tied to status. Becoming 'active' starts
  // the simulated dial loop; anything else stops it.
  if (newStatus === 'active') {
    startPacer(id);
  } else {
    stopPacer(id);
  }

  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'campaign.status_changed',
    targetType: 'campaign',
    targetId: id,
    payload: { from: existing.status, to: newStatus, name: existing.name },
  });
  return NextResponse.json({ ok: true, status: newStatus });
}
