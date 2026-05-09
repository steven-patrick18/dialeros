import { NextRequest, NextResponse } from 'next/server';
import {
  appendAudit,
  deleteCampaign,
  getCampaign,
  getCampaignLeadLists,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const c = getCampaign(id);
  if (!c) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({
    ...c,
    lead_list_ids: getCampaignLeadLists(id),
  });
}

export async function DELETE(
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
  if (existing.status === 'active') {
    return NextResponse.json(
      {
        error:
          'Cannot delete an active campaign. Pause it first, then delete.',
      },
      { status: 409 },
    );
  }
  const ok = deleteCampaign(id);
  if (!ok) {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  appendAudit({
    actorUserId: user.id,
    actorIp: clientIp(req),
    action: 'campaign.deleted',
    targetType: 'campaign',
    targetId: id,
    payload: { name: existing.name },
  });
  return NextResponse.json({ ok: true });
}
