import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  appendAudit,
  getCampaign,
  getUser,
  getUserCampaignIds,
  setUserCampaigns,
} from '@dialeros/control-plane';
import { clientIp, getCurrentUser } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  campaign_ids: z.array(z.string().uuid()),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!getUser(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ campaign_ids: getUserCampaignIds(id) });
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (me.role !== 'admin') {
    return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
  }
  const { id } = await ctx.params;
  const target = getUser(id);
  if (!target) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'campaign_ids must be an array of UUIDs.' },
      { status: 400 },
    );
  }

  // Verify each campaign exists.
  for (const cid of parsed.data.campaign_ids) {
    if (!getCampaign(cid)) {
      return NextResponse.json(
        { error: `Campaign ${cid} not found` },
        { status: 400 },
      );
    }
  }

  const diff = setUserCampaigns(id, parsed.data.campaign_ids);
  if (diff.added.length > 0 || diff.removed.length > 0) {
    appendAudit({
      actorUserId: me.id,
      actorIp: clientIp(req),
      action: 'user.campaigns_changed',
      targetType: 'user',
      targetId: id,
      payload: {
        username: target.username,
        added: diff.added,
        removed: diff.removed,
        total: parsed.data.campaign_ids.length,
      },
    });
  }
  return NextResponse.json({ ok: true, ...diff });
}
